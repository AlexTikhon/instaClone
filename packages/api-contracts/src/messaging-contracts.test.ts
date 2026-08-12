import { describe, expect, it } from 'vitest';

import {
  applicationRealtimeMessageSchema,
  createConversationInputSchema,
  messageCreatedEventSchema,
  sendMessageInputSchema,
} from './index';

describe('messaging contracts', () => {
  it('accepts bounded nonblank text without destructively trimming it', () => {
    const input = { text: '  meaningful spacing  ', clientMessageId: crypto.randomUUID() };
    expect(sendMessageInputSchema.parse(input)).toEqual(input);
    expect(() =>
      sendMessageInputSchema.parse({ text: ' \n\t ', clientMessageId: crypto.randomUUID() }),
    ).toThrow();
    expect(() => sendMessageInputSchema.parse({ ...input, text: 'x'.repeat(4_001) })).toThrow();
  });

  it('uses stable IDs and strict realtime envelopes without message bodies', () => {
    expect(
      createConversationInputSchema.parse({ participantUserId: crypto.randomUUID() }),
    ).toBeDefined();
    const payload = {
      conversationId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      senderId: crypto.randomUUID(),
      recipientId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
    };
    const event = messageCreatedEventSchema.parse({
      eventId: crypto.randomUUID(),
      eventName: 'MESSAGE_CREATED',
      eventVersion: 1,
      aggregateType: 'Message',
      aggregateId: payload.messageId,
      occurredAt: payload.occurredAt,
      correlationId: 'request-1',
      payload,
    });
    expect(event.payload).not.toHaveProperty('text');
    expect(() =>
      applicationRealtimeMessageSchema.parse({
        event: 'MESSAGE_CREATED',
        data: { ...payload, recipientId: undefined, text: 'must not leak' },
      }),
    ).toThrow();
  });
});
