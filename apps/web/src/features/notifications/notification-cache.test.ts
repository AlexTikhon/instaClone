import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { NotificationResponse, NotificationsResponse } from '@instaclone/api-contracts';

import {
  markAllNotificationsReadInCache,
  markNotificationReadInCache,
  mergeRealtimeNotification,
} from './notification-cache';

const notification = (id: string, readAt: string | null = null): NotificationResponse => ({
  id,
  type: 'LIKE',
  createdAt: '2026-08-11T12:00:00.000Z',
  readAt,
  actor: {
    id: '10000000-0000-4000-8000-000000000010',
    username: 'alex',
    displayName: 'Alex',
    isAvailable: true,
  },
  target: {
    postId: '10000000-0000-4000-8000-000000000011',
    commentId: null,
    contentAvailable: true,
  },
});

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const cache = (): InfiniteData<NotificationsResponse, string | undefined> => ({
  pages: [{ items: [notification(firstId)], nextCursor: null, hasMore: false, unreadCount: 1 }],
  pageParams: [undefined],
});

describe('notification cache updates', () => {
  it('prepends realtime notifications, increments unread once, and deduplicates replay', () => {
    const merged = mergeRealtimeNotification(cache(), notification(secondId));
    expect(merged.pages[0]).toMatchObject({ unreadCount: 2 });
    expect(merged.pages[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(mergeRealtimeNotification(merged, notification(secondId))).toBe(merged);
  });

  it('marks one or all notifications read without letting the count go negative', () => {
    const readAt = '2026-08-11T13:00:00.000Z';
    const one = markNotificationReadInCache(cache(), firstId, readAt);
    expect(one?.pages[0]).toMatchObject({ unreadCount: 0 });
    expect(one?.pages[0]?.items[0]?.readAt).toBe(readAt);
    const repeated = markNotificationReadInCache(one, firstId, readAt);
    expect(repeated?.pages[0]?.unreadCount).toBe(0);
    expect(markAllNotificationsReadInCache(cache(), readAt)?.pages[0]?.unreadCount).toBe(0);
  });
});
