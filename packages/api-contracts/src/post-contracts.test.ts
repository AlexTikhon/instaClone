import { describe, expect, it } from 'vitest';

import { createPostInputSchema, listPostsQuerySchema } from './post-contracts';

describe('post contracts', () => {
  it('requires ordered unique media references and a bounded caption', () => {
    const id = crypto.randomUUID();
    expect(createPostInputSchema.parse({ caption: ' hello ', mediaAssetIds: [id] })).toEqual({
      caption: 'hello',
      mediaAssetIds: [id],
    });
    expect(createPostInputSchema.safeParse({ caption: '', mediaAssetIds: [id, id] }).success).toBe(
      false,
    );
  });

  it('coerces a bounded author timeline page size', () => {
    expect(listPostsQuerySchema.parse({ authorId: crypto.randomUUID(), limit: '5' }).limit).toBe(5);
  });
});
