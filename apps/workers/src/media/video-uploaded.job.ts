import { randomUUID } from 'node:crypto';
import { readdir, rm, stat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { videoUploadedEventSchema, type VideoUploadedEvent } from '@instaclone/api-contracts';

import type { MediaObjectStorage } from './media-object-storage';
import type { MediaProcessingRepository, VideoVariantRecord } from './media-processing.repository';
import {
  PermanentVideoError,
  processVideo,
  type ProcessedVideo,
  VIDEO_PROCESSING_VERSION,
  VideoProcessLaunchError,
  VideoProcessTimeoutError,
} from './video-processor';

const LEASE_MS = 90_000;
const LEASE_RENEW_INTERVAL_MS = 20_000;

export interface VideoProcessingResult {
  mediaId: string;
  status: 'READY' | 'FAILED' | 'UNCHANGED';
}

export interface VideoJobAttempt {
  finalAttempt: boolean;
}

interface VideoHandlerOptions {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
}

export class VideoUploadedJobHandler {
  constructor(
    private readonly repository: Pick<
      MediaProcessingRepository,
      'claim' | 'isTerminal' | 'renew' | 'completeVideo' | 'fail' | 'release'
    >,
    private readonly storage: Pick<
      MediaObjectStorage,
      'downloadToFile' | 'putFile' | 'deletePrefix'
    >,
    private readonly options: VideoHandlerOptions,
    private readonly processor: (
      inputPath: string,
      outputDirectory: string,
      options: VideoHandlerOptions,
    ) => Promise<ProcessedVideo> = processVideo,
  ) {}

  async handle(
    input: unknown,
    attempt: VideoJobAttempt = { finalAttempt: false },
  ): Promise<VideoProcessingResult> {
    const event = videoUploadedEventSchema.parse(input);
    const attemptId = randomUUID();
    const asset = await this.repository.claim(event, attemptId, LEASE_MS);
    if (!asset) {
      if (await this.repository.isTerminal(event.payload.mediaId)) {
        return { mediaId: event.payload.mediaId, status: 'UNCHANGED' };
      }
      throw new Error('Video asset is not available for processing');
    }
    if (asset.kind !== 'VIDEO') {
      await this.repository.fail(event.eventId, asset.id, attemptId, 'MEDIA_KIND_MISMATCH');
      return { mediaId: asset.id, status: 'FAILED' };
    }

    const attemptPrefix = videoOutputPrefix(asset.ownerId, asset.id, attemptId);
    if (asset.previousWorkerId) {
      await this.safeCleanup(videoOutputPrefix(asset.ownerId, asset.id, asset.previousWorkerId));
    }
    const tempRoot = path.join(os.tmpdir(), 'instaclone-video');
    await mkdir(tempRoot, { recursive: true });
    const workDirectory = path.join(tempRoot, asset.id, attemptId);
    const sourcePath = path.join(workDirectory, 'source');
    const outputDirectory = path.join(workDirectory, 'output');
    await mkdir(workDirectory, { recursive: true });
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.repository
        .renew(asset.id, attemptId, LEASE_MS)
        .then((owned) => {
          if (!owned) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, LEASE_RENEW_INTERVAL_MS);
    heartbeat.unref();

    try {
      await this.storage.downloadToFile(asset.objectKey, sourcePath);
      const source = await stat(sourcePath);
      if (!asset.verifiedSizeBytes || source.size !== asset.verifiedSizeBytes) {
        throw new PermanentVideoError('FILE_SIZE_MISMATCH', 'Downloaded media size changed');
      }
      const processed = await this.processor(sourcePath, outputDirectory, this.options);
      if (leaseLost || !(await this.repository.renew(asset.id, attemptId, LEASE_MS))) {
        await this.safeCleanup(attemptPrefix);
        return { mediaId: asset.id, status: 'UNCHANGED' };
      }
      const files = await listFiles(outputDirectory);
      const ordered = files.toSorted((left, right) => uploadPriority(left) - uploadPriority(right));
      for (const relativePath of ordered) {
        await this.storage.putFile(
          `${attemptPrefix}/${relativePath.replaceAll('\\', '/')}`,
          path.join(outputDirectory, relativePath),
          contentTypeFor(relativePath),
        );
      }
      const posterObjectKey = `${attemptPrefix}/poster.webp`;
      const variants: VideoVariantRecord[] = [
        {
          type: 'HLS_MASTER',
          label: 'master',
          objectKey: `${attemptPrefix}/master.m3u8`,
          mimeType: 'application/vnd.apple.mpegurl',
          width: null,
          height: null,
          bitrateKbps: null,
        },
        ...processed.renditions.map((rendition): VideoVariantRecord => ({
          type: 'HLS_RENDITION',
          label: rendition.label,
          objectKey: `${attemptPrefix}/${rendition.label}/index.m3u8`,
          mimeType: 'application/vnd.apple.mpegurl',
          width: rendition.width,
          height: rendition.height,
          bitrateKbps: rendition.bitrateKbps,
        })),
        {
          type: 'POSTER',
          label: 'poster',
          objectKey: posterObjectKey,
          mimeType: 'image/webp',
          width: processed.posterWidth,
          height: processed.posterHeight,
          bitrateKbps: null,
        },
      ];
      const completed = await this.repository.completeVideo(event.eventId, asset.id, attemptId, {
        width: processed.probe.width,
        height: processed.probe.height,
        durationMs: processed.probe.durationMs,
        videoCodec: processed.probe.videoCodec,
        audioCodec: processed.probe.audioCodec,
        frameRate: processed.probe.frameRate,
        rotationDegrees: processed.probe.rotationDegrees,
        processingVersion: VIDEO_PROCESSING_VERSION,
        posterObjectKey,
        variants,
      });
      if (!completed) {
        await this.safeCleanup(attemptPrefix);
        return { mediaId: asset.id, status: 'UNCHANGED' };
      }
      return { mediaId: asset.id, status: 'READY' };
    } catch (error) {
      await this.safeCleanup(attemptPrefix);
      const permanentCode =
        error instanceof PermanentVideoError
          ? error.failureCode
          : isNotFoundStorageError(error)
            ? 'SOURCE_MISSING'
            : null;
      const exhaustedCode = attempt.finalAttempt ? exhaustedFailureCode(error) : null;
      if (permanentCode || exhaustedCode) {
        const failed = await this.repository.fail(
          event.eventId,
          asset.id,
          attemptId,
          permanentCode ?? exhaustedCode!,
        );
        return { mediaId: asset.id, status: failed ? 'FAILED' : 'UNCHANGED' };
      }
      await this.repository.release(asset.id, attemptId);
      if (error instanceof VideoProcessTimeoutError) {
        throw new Error('Video processing timed out');
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      await rm(workDirectory, { recursive: true, force: true });
    }
  }

  private async safeCleanup(prefix: string): Promise<void> {
    try {
      await this.storage.deletePrefix(prefix);
    } catch {
      // Attempt namespaces are never exposed unless their DB finalization commits. Orphan cleanup
      // is retried when a stale lease is reclaimed and by the future media-retention job.
    }
  }
}

export const parseVideoUploadedEvent = (input: unknown): VideoUploadedEvent =>
  videoUploadedEventSchema.parse(input);

export const videoOutputPrefix = (ownerId: string, mediaId: string, attemptId: string): string =>
  `users/${ownerId}/media/${mediaId}/video/v1/attempts/${attemptId}`;

const listFiles = async (root: string, relative = ''): Promise<string[]> => {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const child = path.join(relative, entry.name);
      return entry.isDirectory() ? listFiles(root, child) : Promise.resolve([child]);
    }),
  );
  return nested.flat();
};

const isNotFoundStorageError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '$metadata' in error &&
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

const exhaustedFailureCode = (error: unknown): string => {
  if (error instanceof VideoProcessTimeoutError) return 'PROCESSING_TIMEOUT';
  if (error instanceof VideoProcessLaunchError) return 'PROCESSING_RUNTIME_UNAVAILABLE';
  return 'TRANSIENT_PROCESSING_EXHAUSTED';
};

const contentTypeFor = (filePath: string): string => {
  if (filePath.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filePath.endsWith('.ts')) return 'video/mp2t';
  if (filePath.endsWith('.webp')) return 'image/webp';
  throw new Error(`Unexpected generated video output: ${path.basename(filePath)}`);
};

const uploadPriority = (filePath: string): number => {
  if (filePath.endsWith('.ts')) return 0;
  if (filePath.endsWith('/index.m3u8') || filePath.endsWith('\\index.m3u8')) return 1;
  if (filePath.endsWith('poster.webp')) return 2;
  return 3;
};
