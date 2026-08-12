import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_REALTIME_CHANNEL,
  NOTIFICATION_CREATED_MESSAGE,
} from '@instaclone/api-contracts';

import { NotificationRealtimePublisher } from './notification-realtime.publisher';

describe('NotificationRealtimePublisher', () => {
  it('publishes a validated minimal recipient envelope', async () => {
    const redis = { publish: vi.fn().mockResolvedValue(1) };
    const publisher = new NotificationRealtimePublisher(redis as never);
    const recipientId = crypto.randomUUID();
    const notification = {
      id: crypto.randomUUID(),
      type: 'FOLLOW' as const,
      createdAt: new Date().toISOString(),
      readAt: null,
      actor: {
        id: crypto.randomUUID(),
        username: 'alex',
        displayName: 'Alex',
        isAvailable: true,
      },
      target: { postId: null, commentId: null, contentAvailable: null },
    };
    await publisher.publish(recipientId, notification);
    expect(redis.publish).toHaveBeenCalledWith(
      APPLICATION_REALTIME_CHANNEL,
      JSON.stringify({
        recipientId,
        message: { event: NOTIFICATION_CREATED_MESSAGE, data: { notification } },
      }),
    );
  });
});
