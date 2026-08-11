import { describe, expect, it } from 'vitest';

import {
  initializeMediaUploadInputSchema,
  MAX_IMAGE_UPLOAD_BYTES,
  uploadInitializationResponseSchema,
} from './media-contracts';

describe('media contracts', () => {
  it('accepts bounded image upload declarations and rejects unknown fields', () => {
    expect(
      initializeMediaUploadInputSchema.parse({
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      }),
    ).toMatchObject({ kind: 'IMAGE' });
    expect(
      initializeMediaUploadInputSchema.safeParse({
        kind: 'IMAGE',
        mimeType: 'image/svg+xml',
        sizeBytes: 1024,
      }).success,
    ).toBe(false);
    expect(
      initializeMediaUploadInputSchema.safeParse({
        kind: 'IMAGE',
        mimeType: 'image/png',
        sizeBytes: MAX_IMAGE_UPLOAD_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('does not expose an object key in upload responses', () => {
    const result = uploadInitializationResponseSchema.safeParse({
      media: { id: crypto.randomUUID() },
      upload: { objectKey: '../unsafe' },
    });
    expect(result.success).toBe(false);
  });
});
