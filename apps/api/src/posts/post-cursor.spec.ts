import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decodePostCursor, encodePostCursor } from './post-cursor';

describe('post cursor', () => {
  it('round-trips both stable ordering fields and rejects malformed values', () => {
    const cursor = { createdAt: new Date('2026-08-11T08:00:00.000Z'), id: randomUUID() };
    expect(decodePostCursor(encodePostCursor(cursor))).toEqual(cursor);
    expect(() => decodePostCursor('not-a-cursor')).toThrow();
  });
});
