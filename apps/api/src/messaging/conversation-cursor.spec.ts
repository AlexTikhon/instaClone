import { describe, expect, it } from 'vitest';

import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor';

describe('conversation cursor', () => {
  it('round-trips a snapshot and deterministic activity key', () => {
    const value = {
      snapshotAt: new Date('2026-08-12T12:00:00.000Z'),
      activityAt: new Date('2026-08-12T11:00:00.000Z'),
      conversationId: crypto.randomUUID(),
    };
    expect(decodeConversationCursor(encodeConversationCursor(value))).toEqual(value);
  });

  it('rejects impossible or malformed state', () => {
    const impossible = Buffer.from(
      JSON.stringify({
        version: 1,
        snapshotAt: '2026-08-12T11:00:00.000Z',
        activityAt: '2026-08-12T12:00:00.000Z',
        conversationId: crypto.randomUUID(),
      }),
    ).toString('base64url');
    expect(() => decodeConversationCursor(impossible)).toThrow();
    expect(() => decodeConversationCursor('invalid')).toThrow();
  });
});
