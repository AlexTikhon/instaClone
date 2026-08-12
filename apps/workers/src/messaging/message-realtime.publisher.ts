import type Redis from 'ioredis';

import {
  APPLICATION_REALTIME_CHANNEL,
  applicationRealtimeEnvelopeSchema,
  MESSAGE_CREATED_MESSAGE,
  type MessageCreatedPayload,
} from '@instaclone/api-contracts';

export class MessageRealtimePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(recipientId: string, payload: MessageCreatedPayload): Promise<void> {
    const envelope = applicationRealtimeEnvelopeSchema.parse({
      recipientId,
      message: {
        event: MESSAGE_CREATED_MESSAGE,
        data: {
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          senderId: payload.senderId,
          sequence: payload.sequence,
          occurredAt: payload.occurredAt,
        },
      },
    });
    await this.redis.publish(APPLICATION_REALTIME_CHANNEL, JSON.stringify(envelope));
  }
}
