import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiError } from '../platform/errors/api-error';
import { decodeCommentCursor, encodeCommentCursor } from './comment-cursor';

describe('comment cursor', () => {
  it('round-trips stable fields and rejects malformed input with a named code', () => {
    const cursor = { createdAt: new Date('2026-08-11T10:00:00.000Z'), id: randomUUID() };
    expect(decodeCommentCursor(encodeCommentCursor(cursor))).toEqual(cursor);
    let thrown: unknown;
    try {
      decodeCommentCursor('malformed');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).getResponse()).toMatchObject({ code: 'INVALID_COMMENT_CURSOR' });
  });
});
