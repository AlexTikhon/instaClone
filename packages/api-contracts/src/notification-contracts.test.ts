import { describe, expect, it } from 'vitest';

import {
  notificationResponseSchema,
  notificationsQuerySchema,
  realtimeNotificationMessageSchema,
} from './notification-contracts';

const notification = {
  id: crypto.randomUUID(),
  type: 'LIKE' as const,
  createdAt: new Date().toISOString(),
  readAt: null,
  actor: {
    id: crypto.randomUUID(),
    username: 'alex',
    displayName: 'Alex',
    isAvailable: true,
  },
  target: { postId: crypto.randomUUID(), commentId: null, contentAvailable: true },
};

describe('notification contracts', () => {
  it('validates an ergonomic notification without exposing a domain snapshot', () => {
    expect(notificationResponseSchema.parse(notification)).toEqual(notification);
    expect(() =>
      notificationResponseSchema.parse({ ...notification, email: 'hidden@example.com' }),
    ).toThrow();
  });

  it('coerces bounded pagination and validates realtime messages strictly', () => {
    expect(notificationsQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(
      realtimeNotificationMessageSchema.parse({
        event: 'NOTIFICATION_CREATED',
        data: { notification },
      }).data.notification.id,
    ).toBe(notification.id);
  });
});
