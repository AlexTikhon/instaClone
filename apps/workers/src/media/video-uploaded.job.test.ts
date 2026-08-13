import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { VIDEO_UPLOADED_EVENT, type VideoUploadedEvent } from '@instaclone/api-contracts';

import { PermanentVideoError } from './video-processor';
import { VideoUploadedJobHandler } from './video-uploaded.job';

const event = (): VideoUploadedEvent => {
  const mediaId = crypto.randomUUID();
  return {
    eventId: crypto.randomUUID(),
    eventName: VIDEO_UPLOADED_EVENT,
    eventVersion: 1,
    aggregateType: 'MediaAsset',
    aggregateId: mediaId,
    occurredAt: new Date().toISOString(),
    correlationId: 'video-test',
    payload: { mediaId, ownerId: crypto.randomUUID() },
  };
};

const claimed = (input: VideoUploadedEvent) => ({
  id: input.payload.mediaId,
  ownerId: input.payload.ownerId,
  objectKey: 'source',
  declaredMimeType: 'video/mp4',
  verifiedSizeBytes: 3,
  kind: 'VIDEO' as const,
  previousWorkerId: null,
});

const outputs = async (_input: string, output: string) => {
  await mkdir(path.join(output, '360'), { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'master.m3u8'), '#EXTM3U'),
    writeFile(path.join(output, 'poster.webp'), new Uint8Array([1])),
    writeFile(path.join(output, '360', 'index.m3u8'), '#EXTM3U'),
    writeFile(path.join(output, '360', 'segment-00000.ts'), new Uint8Array([1])),
  ]);
  return {
    probe: {
      videoCodec: 'h264',
      audioCodec: null,
      durationMs: 2_000,
      width: 360,
      height: 640,
      frameRate: 24,
      rotationDegrees: 0 as const,
      hasAudio: false,
    },
    renditions: [{ label: '360' as const, width: 360, height: 640, bitrateKbps: 700 }],
    posterWidth: 360,
    posterHeight: 640,
  };
};

const options = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', timeoutMs: 60_000 };

describe('video uploaded job', () => {
  it('streams outputs, finalizes once, and no-ops after READY', async () => {
    const envelope = event();
    const repository = {
      claim: vi.fn().mockResolvedValueOnce(claimed(envelope)).mockResolvedValueOnce(null),
      isTerminal: vi.fn().mockResolvedValue(true),
      renew: vi.fn().mockResolvedValue(true),
      completeVideo: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
      release: vi.fn(),
    };
    const storage = {
      downloadToFile: vi.fn(async (_key: string, destination: string) =>
        writeFile(destination, new Uint8Array([1, 2, 3])),
      ),
      putFile: vi.fn().mockResolvedValue(undefined),
      deletePrefix: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new VideoUploadedJobHandler(repository, storage, options, outputs);
    await expect(handler.handle(envelope)).resolves.toMatchObject({ status: 'READY' });
    expect(storage.putFile).toHaveBeenCalledTimes(4);
    expect(repository.completeVideo).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      expect.anything(),
    );
    expect(JSON.stringify(repository.completeVideo.mock.calls)).toContain('HLS_MASTER');
    await expect(handler.handle(envelope)).resolves.toMatchObject({ status: 'UNCHANGED' });
    expect(repository.completeVideo).toHaveBeenCalledTimes(1);
  });

  it('marks deterministic validation failures terminal and releases transient failures', async () => {
    const envelope = event();
    const baseRepository = () => ({
      claim: vi.fn().mockResolvedValue(claimed(envelope)),
      isTerminal: vi.fn(),
      renew: vi.fn().mockResolvedValue(true),
      completeVideo: vi.fn(),
      fail: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    });
    const storage = () => ({
      downloadToFile: vi.fn(async (_key: string, destination: string) =>
        writeFile(destination, new Uint8Array([1, 2, 3])),
      ),
      putFile: vi.fn(),
      deletePrefix: vi.fn().mockResolvedValue(undefined),
    });
    const permanentRepository = baseRepository();
    const permanent = new VideoUploadedJobHandler(permanentRepository, storage(), options, () =>
      Promise.reject(new PermanentVideoError('INVALID_MEDIA', 'bad source')),
    );
    await expect(permanent.handle(envelope)).resolves.toMatchObject({ status: 'FAILED' });
    expect(permanentRepository.fail).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      'INVALID_MEDIA',
    );

    const transientRepository = baseRepository();
    const transientStorage = storage();
    transientStorage.downloadToFile.mockRejectedValueOnce(new Error('temporary storage failure'));
    const transient = new VideoUploadedJobHandler(
      transientRepository,
      transientStorage,
      options,
      outputs,
    );
    await expect(transient.handle(envelope)).rejects.toThrow('temporary storage failure');
    expect(transientRepository.release).toHaveBeenCalledWith(
      envelope.payload.mediaId,
      expect.any(String),
    );

    const exhaustedRepository = baseRepository();
    const exhaustedStorage = storage();
    exhaustedStorage.putFile.mockRejectedValueOnce(new Error('temporary output failure'));
    const exhausted = new VideoUploadedJobHandler(
      exhaustedRepository,
      exhaustedStorage,
      options,
      outputs,
    );
    await expect(exhausted.handle(envelope, { finalAttempt: true })).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(exhaustedRepository.fail).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      'TRANSIENT_PROCESSING_EXHAUSTED',
    );

    const missingRepository = baseRepository();
    const missingStorage = storage();
    missingStorage.downloadToFile.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } }),
    );
    const missing = new VideoUploadedJobHandler(
      missingRepository,
      missingStorage,
      options,
      outputs,
    );
    await expect(missing.handle(envelope)).resolves.toMatchObject({ status: 'FAILED' });
    expect(missingRepository.fail).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      'SOURCE_MISSING',
    );
  });
});
