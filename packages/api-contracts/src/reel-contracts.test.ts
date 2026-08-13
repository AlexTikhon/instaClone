import { describe, expect, it } from 'vitest';

import {
  MAX_VIDEO_UPLOAD_BYTES,
  initializeMediaUploadInputSchema,
  mediaResponseSchema,
} from './media-contracts';
import { createReelInputSchema, reelResponseSchema } from './reel-contracts';

describe('Reel and video media contracts', () => {
  it('accepts bounded video upload declarations and rejects spoofed or oversized hints', () => {
    expect(
      initializeMediaUploadInputSchema.parse({
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: MAX_VIDEO_UPLOAD_BYTES,
      }),
    ).toMatchObject({ kind: 'VIDEO' });
    expect(() =>
      initializeMediaUploadInputSchema.parse({
        kind: 'VIDEO',
        mimeType: 'video/webm',
        sizeBytes: 10,
      }),
    ).toThrow();
    expect(() =>
      initializeMediaUploadInputSchema.parse({
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: MAX_VIDEO_UPLOAD_BYTES + 1,
      }),
    ).toThrow();
  });

  it('describes processing failures and a storage-opaque HLS response', () => {
    expect(
      mediaResponseSchema.parse({
        id: crypto.randomUUID(),
        kind: 'VIDEO',
        status: 'FAILED',
        declaredMimeType: 'video/mp4',
        declaredSizeBytes: 10,
        verifiedSizeBytes: 10,
        width: null,
        height: null,
        durationMs: null,
        videoCodec: null,
        audioCodec: null,
        frameRate: null,
        rotationDegrees: null,
        failureCode: 'INVALID_MEDIA',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        url: null,
      }),
    ).toMatchObject({ failureCode: 'INVALID_MEDIA' });
    const input = createReelInputSchema.parse({
      mediaAssetId: crypto.randomUUID(),
      caption: ' hi ',
    });
    expect(input.caption).toBe('hi');
    expect(() =>
      reelResponseSchema.parse({
        id: crypto.randomUUID(),
        author: {
          userId: crypto.randomUUID(),
          username: 'author',
          displayName: 'Author',
          bio: '',
          websiteUrl: null,
          isPrivate: false,
        },
        caption: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        playback: {
          type: 'HLS',
          url: 'https://storage.internal/private/master.m3u8',
          posterUrl: '/api/v1/reels/x/poster.webp',
          width: 720,
          height: 1280,
          durationMs: 2_000,
        },
      }),
    ).toThrow();
  });
});
