import { describe, expect, it } from 'vitest';

import { createCommentInputSchema } from './engagement-contracts';

describe('engagement contracts', () => {
  it('trims valid comments and rejects blank, oversized, or unknown input', () => {
    expect(createCommentInputSchema.parse({ body: ' hello ' })).toEqual({ body: 'hello' });
    expect(createCommentInputSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createCommentInputSchema.safeParse({ body: 'x'.repeat(1001) }).success).toBe(false);
    expect(
      createCommentInputSchema.safeParse({ body: 'hello', parentCommentId: 'nope' }).success,
    ).toBe(false);
  });
});
