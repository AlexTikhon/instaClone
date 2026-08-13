import { describe, expect, it } from 'vitest';

import { validateMediaUpload, validateStoredObject } from './media-policy';

describe('media policy', () => {
  it('separates declared policy from stored-object verification', () => {
    const declaration = {
      kind: 'IMAGE' as const,
      mimeType: 'image/jpeg' as const,
      sizeBytes: 1024,
    };
    expect(() => validateMediaUpload(declaration)).not.toThrow();
    expect(
      validateStoredObject(
        {
          kind: declaration.kind,
          mimeType: declaration.mimeType,
          sizeBytes: declaration.sizeBytes,
        },
        { contentType: declaration.mimeType, contentLength: declaration.sizeBytes },
      ),
    ).toBe(1024);
    expect(() =>
      validateStoredObject(
        {
          kind: declaration.kind,
          mimeType: declaration.mimeType,
          sizeBytes: declaration.sizeBytes,
        },
        { contentType: 'image/png', contentLength: declaration.sizeBytes },
      ),
    ).toThrow();
  });
});
