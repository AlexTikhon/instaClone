import { describe, expect, it } from 'vitest';

import { exploreQuerySchema, searchUsersQuerySchema } from './search-contracts';

describe('search contracts', () => {
  it('normalizes a bounded user query and applies defaults', () => {
    expect(searchUsersQuerySchema.parse({ q: '  Alex   Smith ' })).toEqual({
      q: 'alex smith',
      limit: 20,
    });
  });

  it('rejects empty, too-short, oversized, and out-of-range queries', () => {
    for (const query of [
      { q: '' },
      { q: 'a' },
      { q: 'x'.repeat(61) },
      { q: 'alex', limit: 26 },
      { q: 'alex', cursor: 'x'.repeat(513) },
    ]) {
      expect(searchUsersQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('bounds Explore pages', () => {
    expect(exploreQuerySchema.parse({})).toEqual({ limit: 18 });
    expect(exploreQuerySchema.safeParse({ limit: 31 }).success).toBe(false);
  });
});
