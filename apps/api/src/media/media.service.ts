import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { NoSuchKey, NotFound } from '@aws-sdk/client-s3';

import {
  MAX_IMAGE_UPLOAD_BYTES,
  MEDIA_UPLOADED_EVENT,
  MAX_VIDEO_UPLOAD_BYTES,
  VIDEO_UPLOADED_EVENT,
  type InitializeMediaUploadInput,
  type MediaResponse,
  type UploadInitializationResponse,
  type VideoPlayback,
} from '@instaclone/api-contracts';

import type { MediaAsset } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import {
  IMAGE_UPLOAD_URL_TTL_SECONDS,
  validateMediaUpload,
  validateStoredObject,
  VIDEO_UPLOAD_URL_TTL_SECONDS,
} from './media-policy';
import { originalMediaKey } from './storage-key';

export type PostableMediaAsset = Pick<
  MediaAsset,
  | 'id'
  | 'kind'
  | 'status'
  | 'declaredMimeType'
  | 'declaredSizeBytes'
  | 'verifiedSizeBytes'
  | 'width'
  | 'height'
  | 'durationMs'
  | 'createdAt'
  | 'updatedAt'
  | 'thumbnailObjectKey'
> &
  Partial<
    Pick<MediaAsset, 'videoCodec' | 'audioCodec' | 'frameRate' | 'rotationDegrees' | 'failureCode'>
  >;

export type StoryMediaAsset = PostableMediaAsset;

export interface PlayableVideoAsset extends MediaAsset {
  variants: {
    type: 'HLS_MASTER' | 'HLS_RENDITION' | 'POSTER';
    label: string;
    objectKey: string;
  }[];
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async initialize(
    ownerId: string,
    input: InitializeMediaUploadInput,
  ): Promise<UploadInitializationResponse> {
    validateMediaUpload(input);
    const id = randomUUID();
    const objectKey = originalMediaKey(ownerId, id);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id,
        ownerId,
        kind: input.kind,
        objectKey,
        declaredMimeType: input.mimeType,
        declaredSizeBytes: input.sizeBytes,
      },
    });
    const expiresInSeconds =
      input.kind === 'VIDEO' ? VIDEO_UPLOAD_URL_TTL_SECONDS : IMAGE_UPLOAD_URL_TTL_SECONDS;
    const uploadUrl = await this.storage.createUploadUrl({
      contentType: input.mimeType,
      objectKey,
      expiresInSeconds,
    });
    return {
      media: await this.toResponse(asset),
      upload: {
        url: uploadUrl,
        method: 'PUT',
        headers: { 'content-type': input.mimeType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
    };
  }

  async finalize(ownerId: string, mediaId: string, correlationId: string): Promise<MediaResponse> {
    const asset = await this.findOwned(ownerId, mediaId);
    if (asset.status !== 'PENDING_UPLOAD') {
      if (['UPLOADED', 'PROCESSING', 'READY'].includes(asset.status)) {
        return this.toResponse(asset);
      }
      throw new ApiError(HttpStatus.CONFLICT, 'MEDIA_UPLOAD_INVALID', 'Media upload is invalid');
    }

    let stored;
    try {
      stored = await this.storage.headObject(asset.objectKey);
    } catch (error) {
      if (
        error instanceof NoSuchKey ||
        error instanceof NotFound ||
        isNotFoundStorageError(error)
      ) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'MEDIA_UPLOAD_INVALID',
          'Uploaded object was not found',
        );
      }
      throw error;
    }

    let verifiedSizeBytes: number;
    try {
      verifiedSizeBytes = validateStoredObject(
        {
          kind: asset.kind,
          mimeType: asset.declaredMimeType,
          sizeBytes: asset.declaredSizeBytes,
        },
        stored,
      );
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'MEDIA_UPLOAD_INVALID',
        `Uploaded ${asset.kind === 'VIDEO' ? 'video' : 'image'} must match the authorized type and be at most ${
          asset.kind === 'VIDEO' ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES
        } bytes`,
      );
    }

    const event = createOutboxEvent({
      eventName: asset.kind === 'VIDEO' ? VIDEO_UPLOADED_EVENT : MEDIA_UPLOADED_EVENT,
      aggregateType: 'MediaAsset',
      aggregateId: asset.id,
      correlationId,
      payload: { mediaId: asset.id, ownerId },
    });
    const updated = await this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.mediaAsset.updateMany({
        where: { id: asset.id, ownerId, status: 'PENDING_UPLOAD' },
        data: { status: 'UPLOADED', verifiedSizeBytes },
      });
      if (transition.count === 1) {
        await transaction.outboxEvent.create({
          data: { ...event, payload: event.payload },
        });
      }
      return transaction.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    });
    return this.toResponse(updated);
  }

  async getOwn(ownerId: string, mediaId: string): Promise<MediaResponse> {
    return this.toResponse(await this.findOwned(ownerId, mediaId));
  }

  async requireOwnedReadyForPost(
    ownerId: string,
    mediaIds: string[],
  ): Promise<PostableMediaAsset[]> {
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: mediaIds },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        declaredMimeType: true,
        declaredSizeBytes: true,
        verifiedSizeBytes: true,
        width: true,
        height: true,
        durationMs: true,
        videoCodec: true,
        audioCodec: true,
        frameRate: true,
        rotationDegrees: true,
        failureCode: true,
        createdAt: true,
        updatedAt: true,
        thumbnailObjectKey: true,
        ownerId: true,
        postMedia: { select: { postId: true } },
      },
    });
    if (assets.some((asset) => asset.ownerId !== ownerId)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'MEDIA_NOT_OWNED',
        'Media is not owned by this account',
      );
    }
    if (assets.length !== mediaIds.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_POST_MEDIA', 'Post media is invalid');
    }
    if (assets.some((asset) => asset.status !== 'READY')) {
      throw new ApiError(HttpStatus.CONFLICT, 'MEDIA_NOT_READY', 'Media is not ready');
    }
    if (assets.some((asset) => asset.kind !== 'IMAGE')) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_POST_MEDIA',
        'V1 posts accept image media only',
      );
    }
    if (assets.some((asset) => asset.postMedia !== null)) {
      throw new ApiError(HttpStatus.CONFLICT, 'INVALID_POST_MEDIA', 'Media is already attached');
    }
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return mediaIds.map((id) => {
      const asset = byId.get(id);
      if (!asset) throw new Error('Validated media asset is missing');
      return asset;
    });
  }

  async requireOwnedReadyForStory(ownerId: string, mediaId: string): Promise<StoryMediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (asset?.ownerId !== ownerId) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'STORY_MEDIA_NOT_OWNED',
        'Story media is not owned by this account',
      );
    }
    if (asset.status !== 'READY') {
      throw new ApiError(HttpStatus.CONFLICT, 'STORY_MEDIA_NOT_READY', 'Story media is not ready');
    }
    if (asset.kind !== 'IMAGE') {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STORY_MEDIA',
        'Only image Stories are supported',
      );
    }
    return asset;
  }

  async requireOwnedReadyForReel(ownerId: string, mediaId: string): Promise<PlayableVideoAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      include: { variants: true },
    });
    if (asset?.ownerId !== ownerId) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'REEL_MEDIA_NOT_OWNED',
        'Reel media is not owned by this account',
      );
    }
    if (asset.kind !== 'VIDEO') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_REEL_MEDIA', 'Reels require video media');
    }
    if (asset.status !== 'READY') {
      throw new ApiError(HttpStatus.CONFLICT, 'REEL_MEDIA_NOT_READY', 'Reel media is not ready');
    }
    if (!this.hasCompleteVideoPresentation(asset)) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'REEL_MEDIA_NOT_READY',
        'Video presentation outputs are incomplete',
      );
    }
    return asset;
  }

  toVideoPlayback(asset: PlayableVideoAsset, reelId: string): VideoPlayback {
    if (!this.hasCompleteVideoPresentation(asset)) {
      throw new Error('READY video is missing required presentation outputs');
    }
    return {
      type: 'HLS',
      url: `/api/v1/reels/${reelId}/playback/master.m3u8`,
      posterUrl: `/api/v1/reels/${reelId}/poster.webp`,
      width: asset.width!,
      height: asset.height!,
      durationMs: asset.durationMs!,
    };
  }

  async getVideoDeliveryObject(
    mediaId: string,
    relativePath: string,
  ): Promise<Awaited<ReturnType<ObjectStorageService['getObjectStream']>>> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaId, kind: 'VIDEO', status: 'READY' },
      include: { variants: true },
    });
    if (!asset || !this.hasCompleteVideoPresentation(asset)) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'VIDEO_OUTPUT_NOT_FOUND',
        'Video output was not found',
      );
    }
    let objectKey: string | null = null;
    if (relativePath === 'master.m3u8') {
      objectKey =
        asset.variants.find((variant) => variant.type === 'HLS_MASTER')?.objectKey ?? null;
    } else if (relativePath === 'poster.webp') {
      objectKey = asset.variants.find((variant) => variant.type === 'POSTER')?.objectKey ?? null;
    } else {
      const match = /^(360|720|1080)\/(index\.m3u8|segment-\d{5}\.ts)$/.exec(relativePath);
      if (match) {
        const rendition = asset.variants.find(
          (variant) => variant.type === 'HLS_RENDITION' && variant.label === match[1],
        );
        if (rendition) {
          objectKey =
            match[2] === 'index.m3u8'
              ? rendition.objectKey
              : `${rendition.objectKey.slice(0, -'index.m3u8'.length)}${match[2]}`;
        }
      }
    }
    if (!objectKey) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'VIDEO_OUTPUT_NOT_FOUND',
        'Video output was not found',
      );
    }
    return this.storage.getObjectStream(objectKey);
  }

  toResponse(asset: PostableMediaAsset): Promise<MediaResponse>;
  toResponse(asset: MediaAsset): Promise<MediaResponse>;
  async toResponse(asset: PostableMediaAsset | MediaAsset): Promise<MediaResponse> {
    const url =
      asset.status === 'READY' && asset.thumbnailObjectKey
        ? await this.storage.createDownloadUrl(asset.thumbnailObjectKey)
        : null;
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      declaredMimeType: asset.declaredMimeType,
      declaredSizeBytes: asset.declaredSizeBytes,
      verifiedSizeBytes: asset.verifiedSizeBytes,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      videoCodec: asset.videoCodec ?? null,
      audioCodec: asset.audioCodec ?? null,
      frameRate: asset.frameRate ?? null,
      rotationDegrees:
        asset.rotationDegrees === 0 ||
        asset.rotationDegrees === 90 ||
        asset.rotationDegrees === 180 ||
        asset.rotationDegrees === 270
          ? asset.rotationDegrees
          : null,
      failureCode: asset.failureCode ?? null,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      url,
    };
  }

  private async findOwned(ownerId: string, mediaId: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, ownerId } });
    if (!asset) throw new ApiError(HttpStatus.NOT_FOUND, 'MEDIA_NOT_FOUND', 'Media was not found');
    return asset;
  }

  private hasCompleteVideoPresentation(asset: PlayableVideoAsset): boolean {
    return (
      asset.status === 'READY' &&
      asset.width !== null &&
      asset.height !== null &&
      asset.durationMs !== null &&
      asset.processingVersion !== null &&
      asset.variants.some((variant) => variant.type === 'HLS_MASTER') &&
      asset.variants.some((variant) => variant.type === 'HLS_RENDITION') &&
      asset.variants.some((variant) => variant.type === 'POSTER')
    );
  }
}

const isNotFoundStorageError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '$metadata' in error &&
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
