'use client';

import type { NotificationResponse } from '@instaclone/api-contracts';

import { useMarkAllNotificationsRead, useMarkNotificationRead } from './use-notification-mutations';
import type { useNotifications } from './use-notifications';

const notificationText = (notification: NotificationResponse): string => {
  const actor = notification.actor.isAvailable
    ? `@${notification.actor.username}`
    : notification.actor.displayName;
  switch (notification.type) {
    case 'LIKE':
      return `${actor} liked your post`;
    case 'COMMENT':
      return `${actor} commented on your post`;
    case 'FOLLOW':
      return `${actor} started following you`;
    case 'FOLLOW_REQUEST':
      return `${actor} requested to follow you`;
  }
};

const relativeTime = (value: string): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export function NotificationsPanel({
  notifications,
}: {
  notifications: ReturnType<typeof useNotifications>;
}) {
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  if (notifications.isPending) {
    return <section className="notificationState">Loading notifications…</section>;
  }
  if (notifications.isError) {
    return (
      <section className="notificationState" role="alert">
        <h2>Notifications unavailable</h2>
        <p>Your activity is safe. Try loading it again.</p>
        <button type="button" onClick={() => void notifications.refetch()}>
          Try again
        </button>
      </section>
    );
  }
  const items = notifications.data.pages.flatMap((page) => page.items);
  const unreadCount = notifications.data.pages[0]?.unreadCount ?? 0;
  return (
    <section className="notifications" aria-labelledby="notifications-title">
      <div className="notificationHeader">
        <div>
          <p className="eyebrow">Activity</p>
          <h2 id="notifications-title">Notifications</h2>
        </div>
        <button
          type="button"
          className="secondaryButton"
          disabled={unreadCount === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          Mark all read
        </button>
      </div>
      {items.length === 0 ? <p className="notificationState">No notifications yet.</p> : null}
      <ul className="notificationList">
        {items.map((notification) => (
          <li key={notification.id} className={notification.readAt ? '' : 'notificationUnread'}>
            <button
              type="button"
              className="notificationItem"
              disabled={markRead.isPending && markRead.variables === notification.id}
              onClick={() => {
                if (!notification.readAt) markRead.mutate(notification.id);
              }}
            >
              <span>{notificationText(notification)}</span>
              <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
              {notification.target.contentAvailable === false ? (
                <small>Content is no longer available.</small>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {notifications.hasNextPage ? (
        <button
          type="button"
          className="loadMore"
          disabled={notifications.isFetchingNextPage}
          onClick={() => void notifications.fetchNextPage()}
        >
          {notifications.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
