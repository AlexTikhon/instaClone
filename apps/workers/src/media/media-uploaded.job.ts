import { mediaUploadedEventSchema, type MediaUploadedEvent } from '@instaclone/api-contracts';

import { PermanentMediaError, processImage, thumbnailObjectKey } from './image-processor';
import type { MediaObjectStorage } from './media-object-storage';
import type { MediaProcessingRepository } from './media-processing.repository';

export interface MediaProcessingResult {
  mediaId: string;
  status: 'READY' | 'FAILED' | 'UNCHANGED';
}

export class MediaUploadedJobHandler {
  constructor(
    private readonly repository: Pick<
      MediaProcessingRepository,
      'claim' | 'isTerminal' | 'complete' | 'fail' | 'release'
    >,
    private readonly storage: Pick<MediaObjectStorage, 'download' | 'putThumbnail'>,
  ) {}

  async handle(input: unknown): Promise<MediaProcessingResult> {
    const event = mediaUploadedEventSchema.parse(input);
    const workerId = randomUUID();
    const asset = await this.repository.claim(event, workerId);
    if (!asset) {
      if (await this.repository.isTerminal(event.payload.mediaId)) {
        return { mediaId: event.payload.mediaId, status: 'UNCHANGED' };
      }
      throw new Error('Media asset is not available for processing');
    }

    try {
      const original = await this.storage.download(asset.objectKey);
      if (original.byteLength !== asset.verifiedSizeBytes) {
        throw new PermanentMediaError('FILE_SIZE_MISMATCH', 'Downloaded media size changed');
      }
      const processed = await processImage(original);
      const thumbnailKey = thumbnailObjectKey(asset.ownerId, asset.id);
      await this.storage.putThumbnail(thumbnailKey, processed.thumbnail);
      const completed = await this.repository.complete(event.eventId, asset.id, workerId, {
        width: processed.width,
        height: processed.height,
        thumbnailObjectKey: thumbnailKey,
      });
      if (!completed) return { mediaId: asset.id, status: 'UNCHANGED' };
      return { mediaId: asset.id, status: 'READY' };
    } catch (error) {
      if (error instanceof PermanentMediaError) {
        const failed = await this.repository.fail(
          event.eventId,
          asset.id,
          workerId,
          error.failureCode,
        );
        return { mediaId: asset.id, status: failed ? 'FAILED' : 'UNCHANGED' };
      }
      await this.repository.release(asset.id, workerId);
      throw error;
    }
  }
}

export const parseMediaUploadedEvent = (input: unknown): MediaUploadedEvent =>
  mediaUploadedEventSchema.parse(input);
import { randomUUID } from 'node:crypto';
