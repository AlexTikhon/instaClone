'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getNotifications } from '../../entities/notification/api';
import { queryKeys } from '../feed/query-keys';

export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: queryKeys.notifications,
    queryFn: ({ pageParam }) => getNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });
