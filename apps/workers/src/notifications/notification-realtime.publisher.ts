import type Redis from 'ioredis';

import {
  NOTIFICATION_REALTIME_CHANNEL,
  notificationRealtimeEnvelopeSchema,
  type NotificationResponse,
} from '@instaclone/api-contracts';

export class NotificationRealtimePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(recipientId: string, notification: NotificationResponse): Promise<void> {
    const envelope = notificationRealtimeEnvelopeSchema.parse({
      recipientId,
      payload: { notification },
    });
    await this.redis.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(envelope));
  }
}
