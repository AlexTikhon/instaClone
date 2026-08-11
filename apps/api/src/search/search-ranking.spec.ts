import { describe, expect, it } from 'vitest';

import { escapeLikePattern, USER_SEARCH_RANK } from './search-ranking';

describe('search ranking policy', () => {
  it('keeps every relevance tier explicit and ordered', () => {
    expect(Object.values(USER_SEARCH_RANK)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLikePattern('alex_100%\\name')).toBe('alex\\_100\\%\\\\name');
  });
});
