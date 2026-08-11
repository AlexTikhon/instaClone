import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { NoSuchKey, NotFound } from '@aws-sdk/client-s3';

import {
  MAX_IMAGE_UPLOAD_BYTES,
  MEDIA_UPLOADED_EVENT,
  type InitializeMediaUploadInput,
  type MediaResponse,
  type UploadInitializationResponse,
} from '@instaclone/api-contracts';

import type { MediaAsset } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import {
  IMAGE_UPLOAD_URL_TTL_SECONDS,
  validateImageUpload,
  validateStoredObject,
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
>;

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
    validateImageUpload(input);
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
    const uploadUrl = await this.storage.createUploadUrl({
      contentType: input.mimeType,
      objectKey,
      expiresInSeconds: IMAGE_UPLOAD_URL_TTL_SECONDS,
    });
    return {
      media: await this.toResponse(asset),
      upload: {
        url: uploadUrl,
        method: 'PUT',
        headers: { 'content-type': input.mimeType },
        expiresAt: new Date(Date.now() + IMAGE_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
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
        { mimeType: asset.declaredMimeType, sizeBytes: asset.declaredSizeBytes },
        stored,
      );
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'MEDIA_UPLOAD_INVALID',
        `Uploaded image must match the authorized type and be at most ${MAX_IMAGE_UPLOAD_BYTES} bytes`,
      );
    }

    const event = createOutboxEvent({
      eventName: MEDIA_UPLOADED_EVENT,
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
}

const isNotFoundStorageError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '$metadata' in error &&
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
