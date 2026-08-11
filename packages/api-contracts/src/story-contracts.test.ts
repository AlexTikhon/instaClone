import { describe, expect, it } from 'vitest';

import {
  createStoryInputSchema,
  storyTrayResponseSchema,
  storyViewersQuerySchema,
} from './story-contracts';

const id = '00000000-0000-4000-8000-000000000001';

describe('story contracts', () => {
  it('accepts only a media asset identifier for creation', () => {
    expect(createStoryInputSchema.parse({ mediaAssetId: id })).toEqual({ mediaAssetId: id });
    expect(() => createStoryInputSchema.parse({ mediaAssetId: id, authorId: id })).toThrow();
    expect(() =>
      createStoryInputSchema.parse({ mediaAssetId: id, expiresAt: new Date() }),
    ).toThrow();
  });

  it('coerces bounded viewer pagination and rejects unknown fields', () => {
    expect(storyViewersQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
    expect(() => storyViewersQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => storyViewersQuerySchema.parse({ limit: 25, storyId: id })).toThrow();
  });

  it('keeps tray responses strict', () => {
    expect(() => storyTrayResponseSchema.parse({ groups: [], extra: true })).toThrow();
  });
});
