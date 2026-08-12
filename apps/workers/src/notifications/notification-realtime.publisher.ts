import type Redis from 'ioredis';

import {
  APPLICATION_REALTIME_CHANNEL,
  applicationRealtimeEnvelopeSchema,
  NOTIFICATION_CREATED_MESSAGE,
  type NotificationResponse,
} from '@instaclone/api-contracts';

export class NotificationRealtimePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(recipientId: string, notification: NotificationResponse): Promise<void> {
    const envelope = applicationRealtimeEnvelopeSchema.parse({
      recipientId,
      message: { event: NOTIFICATION_CREATED_MESSAGE, data: { notification } },
    });
    await this.redis.publish(APPLICATION_REALTIME_CHANNEL, JSON.stringify(envelope));
  }
}
