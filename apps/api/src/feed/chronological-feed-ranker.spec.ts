import { describe, expect, it } from 'vitest';

import { ChronologicalFeedRanker } from './chronological-feed-ranker';

describe('ChronologicalFeedRanker', () => {
  it('orders by createdAt DESC then id DESC without using engagement', () => {
    const early = { id: '10000000-0000-4000-8000-000000000000', createdAt: new Date('2026-01-01') };
    const lower = { id: '20000000-0000-4000-8000-000000000000', createdAt: new Date('2026-01-02') };
    const higher = {
      id: '30000000-0000-4000-8000-000000000000',
      createdAt: new Date('2026-01-02'),
    };
    expect(new ChronologicalFeedRanker().rank('viewer', [early, lower, higher])).toEqual([
      higher,
      lower,
      early,
    ]);
  });
});
