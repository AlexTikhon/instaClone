'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getFeed } from '../../entities/feed/api';
import { queryKeys } from './query-keys';

export const useFeed = () =>
  useInfiniteQuery({
    queryKey: queryKeys.feed,
    queryFn: ({ pageParam, signal }) => getFeed(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
