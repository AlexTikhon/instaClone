'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getReels } from '../../entities/reel/api';

export const reelsQueryKey = ['reels'] as const;

export const useReels = () =>
  useInfiniteQuery({
    queryKey: reelsQueryKey,
    queryFn: ({ pageParam, signal }) => getReels(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
