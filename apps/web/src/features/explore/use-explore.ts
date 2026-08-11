'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getExplore } from '../../entities/search/api';
import { queryKeys } from '../feed/query-keys';

export const useExplore = () =>
  useInfiniteQuery({
    queryKey: queryKeys.explore,
    queryFn: ({ pageParam, signal }) => getExplore(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
