import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { ApiError } from '../platform/errors/api-error';

describe('feed cursor', () => {
  it('round-trips the immutable ordering tuple', () => {
    const cursor = { createdAt: new Date('2026-08-11T10:00:00.000Z'), postId: randomUUID() };
    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed and oversized values with the feed error code', () => {
    for (const value of ['not-a-cursor', 'x'.repeat(513)]) {
      let thrown: unknown;
      try {
        decodeFeedCursor(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).getResponse()).toMatchObject({ code: 'INVALID_FEED_CURSOR' });
    }
  });
});
