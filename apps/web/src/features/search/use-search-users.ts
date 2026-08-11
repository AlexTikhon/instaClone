'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { MIN_SEARCH_QUERY_LENGTH } from '@instaclone/api-contracts';

import { searchUsers } from '../../entities/search/api';
import { queryKeys } from '../feed/query-keys';

export const normalizeSearchQuery = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export const useSearchUsers = (query: string) =>
  useInfiniteQuery({
    queryKey: queryKeys.searchUsers(query),
    queryFn: ({ pageParam, signal }) => searchUsers(query, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: query.length >= MIN_SEARCH_QUERY_LENGTH,
  });
