import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiError } from '../platform/errors/api-error';
import {
  decodeExploreCursor,
  decodeSearchCursor,
  encodeExploreCursor,
  encodeSearchCursor,
} from './search-cursor';

describe('search cursors', () => {
  it('round-trips the user search ordering tuple and binds it to the query', () => {
    const cursor = {
      query: 'alex',
      rank: 2,
      normalizedUsername: 'alexander',
      userId: randomUUID(),
    };
    expect(decodeSearchCursor(encodeSearchCursor(cursor), 'alex')).toEqual(cursor);
    expect(() => decodeSearchCursor(encodeSearchCursor(cursor), 'different')).toThrow(ApiError);
  });

  it('round-trips the Explore snapshot and rank tuple', () => {
    const cursor = {
      snapshotAt: new Date('2026-08-11T18:00:00.000Z'),
      score: 42,
      createdAt: new Date('2026-08-11T10:00:00.000Z'),
      postId: randomUUID(),
    };
    expect(decodeExploreCursor(encodeExploreCursor(cursor))).toEqual(cursor);
  });

  it('uses stable endpoint-specific errors for malformed cursors', () => {
    for (const [operation, code] of [
      [() => decodeSearchCursor('malformed', 'alex'), 'INVALID_SEARCH_CURSOR'],
      [() => decodeExploreCursor('malformed'), 'INVALID_EXPLORE_CURSOR'],
    ] as const) {
      let thrown: unknown;
      try {
        operation();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).getResponse()).toMatchObject({ code });
    }
  });
});
