import type { Logger } from 'pino';

import { messageCreatedEventSchema } from '@instaclone/api-contracts';

import type { MessageRealtimePublisher } from './message-realtime.publisher';

export class MessageCreatedHandler {
  constructor(
    private readonly realtime: Pick<MessageRealtimePublisher, 'publish'>,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  async handle(input: unknown): Promise<{ status: 'SIGNALLED' | 'SIGNAL_FAILED' }> {
    const event = messageCreatedEventSchema.parse(input);
    try {
      await Promise.all([
        this.realtime.publish(event.payload.recipientId, event.payload),
        this.realtime.publish(event.payload.senderId, event.payload),
      ]);
      return { status: 'SIGNALLED' };
    } catch (error) {
      this.logger.warn(
        {
          correlationId: event.correlationId,
          eventId: event.eventId,
          messageId: event.payload.messageId,
          conversationId: event.payload.conversationId,
          error,
        },
        'message realtime publish failed; durable message remains available',
      );
      return { status: 'SIGNAL_FAILED' };
    }
  }
}
