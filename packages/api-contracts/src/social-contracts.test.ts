import { describe, expect, it } from 'vitest';

import {
  followRequestsResponseSchema,
  socialConnectionResponseSchema,
  socialUserIdSchema,
} from './social-contracts';

describe('social contracts', () => {
  it('accepts the two follow transition outcomes', () => {
    expect(socialConnectionResponseSchema.parse({ state: 'following' })).toEqual({
      state: 'following',
    });
    expect(socialConnectionResponseSchema.parse({ state: 'requested' })).toEqual({
      state: 'requested',
    });
  });

  it('rejects invalid actor identifiers and malformed request lists', () => {
    expect(socialUserIdSchema.safeParse('../me').success).toBe(false);
    expect(
      followRequestsResponseSchema.safeParse({ requests: [{ requester: {} }], nextCursor: null })
        .success,
    ).toBe(false);
  });
});
