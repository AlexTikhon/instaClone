import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { originalMediaKey, thumbnailMediaKey } from './storage-key';

describe('media storage keys', () => {
  it('generates an ownership namespace only from canonical server identifiers', () => {
    const ownerId = randomUUID();
    const mediaId = randomUUID();
    expect(originalMediaKey(ownerId, mediaId)).toBe(`users/${ownerId}/media/${mediaId}/original`);
    expect(thumbnailMediaKey(ownerId, mediaId)).toBe(`users/${ownerId}/media/${mediaId}/thumb-640`);
    expect(() => originalMediaKey('../other-user', mediaId)).toThrow();
  });
});
