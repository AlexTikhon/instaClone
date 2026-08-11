import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { MEDIA_UPLOADED_EVENT, type MediaUploadedEvent } from '@instaclone/api-contracts';

import { MediaUploadedJobHandler } from './media-uploaded.job';

const event = (): MediaUploadedEvent => {
  const mediaId = crypto.randomUUID();
  return {
    eventId: crypto.randomUUID(),
    eventName: MEDIA_UPLOADED_EVENT,
    eventVersion: 1,
    aggregateType: 'MediaAsset',
    aggregateId: mediaId,
    occurredAt: new Date().toISOString(),
    correlationId: 'request-123',
    payload: { mediaId, ownerId: crypto.randomUUID() },
  };
};

describe('media uploaded job', () => {
  it('moves a valid image to READY and writes a deterministic derivative', async () => {
    const envelope = event();
    const original = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const repository = {
      claim: vi.fn().mockResolvedValue({
        id: envelope.payload.mediaId,
        ownerId: envelope.payload.ownerId,
        objectKey: 'original',
        declaredMimeType: 'image/jpeg',
        verifiedSizeBytes: original.byteLength,
      }),
      isTerminal: vi.fn(),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
      release: vi.fn(),
    };
    const storage = {
      download: vi.fn().mockResolvedValue(original),
      putThumbnail: vi.fn().mockResolvedValue(undefined),
    };
    const result = await new MediaUploadedJobHandler(repository, storage).handle(envelope);
    expect(result.status).toBe('READY');
    expect(storage.putThumbnail).toHaveBeenCalledWith(
      `users/${envelope.payload.ownerId}/media/${envelope.payload.mediaId}/thumb-640`,
      expect.any(Uint8Array),
    );
    expect(repository.complete).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      expect.objectContaining({ width: 80, height: 40 }),
    );
  });

  it('marks permanent decode failures and treats terminal retries as unchanged', async () => {
    const envelope = event();
    const repository = {
      claim: vi
        .fn()
        .mockResolvedValueOnce({
          id: envelope.payload.mediaId,
          ownerId: envelope.payload.ownerId,
          objectKey: 'original',
          declaredMimeType: 'image/jpeg',
          verifiedSizeBytes: 3,
        })
        .mockResolvedValueOnce(null),
      isTerminal: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(true),
      release: vi.fn(),
    };
    const storage = {
      download: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      putThumbnail: vi.fn(),
    };
    const handler = new MediaUploadedJobHandler(repository, storage);
    await expect(handler.handle(envelope)).resolves.toMatchObject({ status: 'FAILED' });
    expect(repository.fail).toHaveBeenCalledWith(
      envelope.eventId,
      envelope.payload.mediaId,
      expect.any(String),
      'DECODE_FAILED',
    );
    await expect(handler.handle(envelope)).resolves.toMatchObject({ status: 'UNCHANGED' });
  });

  it('releases its owned lease when a transient storage error should retry', async () => {
    const envelope = event();
    const repository = {
      claim: vi.fn().mockResolvedValue({
        id: envelope.payload.mediaId,
        ownerId: envelope.payload.ownerId,
        objectKey: 'original',
        declaredMimeType: 'image/jpeg',
        verifiedSizeBytes: 100,
      }),
      isTerminal: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      download: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
      putThumbnail: vi.fn(),
    };
    await expect(new MediaUploadedJobHandler(repository, storage).handle(envelope)).rejects.toThrow(
      'S3 unavailable',
    );
    expect(repository.claim).toHaveBeenCalledWith(envelope, expect.any(String));
    expect(repository.release).toHaveBeenCalledWith(envelope.payload.mediaId, expect.any(String));
  });
});
