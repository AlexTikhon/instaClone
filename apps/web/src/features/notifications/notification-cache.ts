import type { InfiniteData } from '@tanstack/react-query';

import type { NotificationResponse, NotificationsResponse } from '@instaclone/api-contracts';

export type NotificationsCache = InfiniteData<NotificationsResponse, string | undefined>;

export const mergeRealtimeNotification = (
  current: NotificationsCache | undefined,
  notification: NotificationResponse,
): NotificationsCache => {
  if (!current) {
    return {
      pages: [
        {
          items: [notification],
          nextCursor: null,
          hasMore: false,
          unreadCount: notification.readAt ? 0 : 1,
        },
      ],
      pageParams: [undefined],
    };
  }
  const exists = current.pages.some((page) =>
    page.items.some((item) => item.id === notification.id),
  );
  if (exists) return current;
  const unreadCount = (current.pages[0]?.unreadCount ?? 0) + (notification.readAt ? 0 : 1);
  return {
    ...current,
    pages: current.pages.map((page, index) => ({
      ...page,
      unreadCount,
      items:
        index === 0
          ? [notification, ...page.items.filter((item) => item.id !== notification.id)]
          : page.items.filter((item) => item.id !== notification.id),
    })),
  };
};

export const markNotificationReadInCache = (
  current: NotificationsCache | undefined,
  notificationId: string,
  readAt: string,
): NotificationsCache | undefined => {
  if (!current) return current;
  const wasUnread = current.pages.some((page) =>
    page.items.some((item) => item.id === notificationId && item.readAt === null),
  );
  const unreadCount = Math.max(0, (current.pages[0]?.unreadCount ?? 0) - (wasUnread ? 1 : 0));
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      unreadCount,
      items: page.items.map((item) =>
        item.id === notificationId ? { ...item, readAt: item.readAt ?? readAt } : item,
      ),
    })),
  };
};

export const markAllNotificationsReadInCache = (
  current: NotificationsCache | undefined,
  readAt: string,
): NotificationsCache | undefined =>
  current
    ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          unreadCount: 0,
          items: page.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
        })),
      }
    : current;
