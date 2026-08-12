import { describe, expect, it, vi } from 'vitest';

import { MessageCreatedHandler } from './message-created.handler';

const event = () => {
  const occurredAt = new Date().toISOString();
  const messageId = crypto.randomUUID();
  return {
    eventId: crypto.randomUUID(),
    eventName: 'MESSAGE_CREATED',
    eventVersion: 1,
    aggregateType: 'Message',
    aggregateId: messageId,
    occurredAt,
    correlationId: 'request-1',
    payload: {
      conversationId: crypto.randomUUID(),
      messageId,
      senderId: crypto.randomUUID(),
      recipientId: crypto.randomUUID(),
      sequence: 7,
      occurredAt,
    },
  };
};

describe('MessageCreatedHandler', () => {
  it('signals both recipient and sender sessions without requiring durable socket delivery', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const handler = new MessageCreatedHandler({ publish }, { warn: vi.fn() });
    const input = event();
    await expect(handler.handle(input)).resolves.toEqual({ status: 'SIGNALLED' });
    expect(publish).toHaveBeenCalledWith(input.payload.recipientId, input.payload);
    expect(publish).toHaveBeenCalledWith(input.payload.senderId, input.payload);
  });

  it('keeps a realtime outage best-effort after the durable message commit', async () => {
    const warn = vi.fn();
    const handler = new MessageCreatedHandler(
      { publish: vi.fn().mockRejectedValue(new Error('redis unavailable')) },
      { warn },
    );
    await expect(handler.handle(event())).resolves.toEqual({ status: 'SIGNAL_FAILED' });
    expect(warn).toHaveBeenCalledOnce();
  });
});
