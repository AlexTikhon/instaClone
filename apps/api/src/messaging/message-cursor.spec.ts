import { describe, expect, it } from 'vitest';

import { decodeMessageCursor, encodeMessageCursor } from './message-cursor';

describe('message cursor', () => {
  it('round-trips a conversation-bound sequence', () => {
    const conversationId = crypto.randomUUID();
    expect(
      decodeMessageCursor(
        encodeMessageCursor({ conversationId, beforeSequence: 42n }),
        conversationId,
      ),
    ).toEqual({ conversationId, beforeSequence: 42n });
  });

  it('rejects malformed and cross-conversation cursors', () => {
    const conversationId = crypto.randomUUID();
    const cursor = encodeMessageCursor({ conversationId, beforeSequence: 1n });
    expect(() => decodeMessageCursor(cursor, crypto.randomUUID())).toThrow();
    expect(() => decodeMessageCursor('not-a-cursor', conversationId)).toThrow();
  });
});
