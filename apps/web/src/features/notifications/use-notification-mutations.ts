'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { markAllNotificationsRead, markNotificationRead } from '../../entities/notification/api';
import { queryKeys } from '../feed/query-keys';
import {
  markAllNotificationsReadInCache,
  markNotificationReadInCache,
  type NotificationsCache,
} from './notification-cache';

export const useMarkNotificationRead = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (notificationId) => {
      await client.cancelQueries({ queryKey: queryKeys.notifications });
      const previous = client.getQueryData<NotificationsCache>(queryKeys.notifications);
      client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
        markNotificationReadInCache(current, notificationId, new Date().toISOString()),
      );
      return { previous };
    },
    onError: (_error, _notificationId, context) => {
      if (context?.previous) client.setQueryData(queryKeys.notifications, context.previous);
    },
    onSuccess: (notification) => {
      if (!notification.readAt) return;
      client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
        markNotificationReadInCache(current, notification.id, notification.readAt!),
      );
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: queryKeys.notifications });
      const previous = client.getQueryData<NotificationsCache>(queryKeys.notifications);
      client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
        markAllNotificationsReadInCache(current, new Date().toISOString()),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(queryKeys.notifications, context.previous);
    },
    onSuccess: (result) => {
      client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
        markAllNotificationsReadInCache(current, result.readAt),
      );
    },
  });
};
