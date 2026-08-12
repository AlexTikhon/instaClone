import { describe, expect, it } from 'vitest';

import { mergeMessage, uniqueChronologicalMessages, type MessagesCache } from './messaging-cache';

const message = (sequence: number, id = crypto.randomUUID()) => ({
  id,
  conversationId: '10000000-0000-4000-8000-000000000001',
  senderId: '10000000-0000-4000-8000-000000000002',
  sequence,
  text: `message ${sequence}`,
  clientMessageId: crypto.randomUUID(),
  createdAt: new Date(sequence * 1_000).toISOString(),
});

describe('messaging cache', () => {
  it('deduplicates POST and realtime/refetch copies by stable server and client IDs', () => {
    const confirmed = message(2);
    const initial = mergeMessage(undefined, confirmed);
    expect(mergeMessage(initial, confirmed)).toEqual(initial);
    const sameClient = { ...message(2), clientMessageId: confirmed.clientMessageId };
    const reconciled = mergeMessage(initial, sameClient);
    expect(reconciled.pages.flatMap((page) => page.items)).toEqual([sameClient]);
  });

  it('renders backward-loaded pages in unique chronological order', () => {
    const older = message(1);
    const newer = message(2);
    const cache: MessagesCache = {
      pages: [
        { items: [newer], hasMore: true, nextCursor: 'older' },
        { items: [older, newer], hasMore: false, nextCursor: null },
      ],
      pageParams: [undefined, 'older'],
    };
    expect(uniqueChronologicalMessages(cache).map((item) => item.sequence)).toEqual([1, 2]);
  });
});
