import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createOutboxEvent } from './event-envelope';

describe('outbox event envelope', () => {
  it('preserves aggregate and request correlation identity', () => {
    const aggregateId = randomUUID();
    const event = createOutboxEvent({
      eventName: 'POST_CREATED',
      aggregateType: 'Post',
      aggregateId,
      correlationId: 'request-123',
      payload: { postId: aggregateId },
    });
    expect(event).toMatchObject({ aggregateId, correlationId: 'request-123', eventVersion: 1 });
    expect(event.eventId).not.toBe(aggregateId);
  });
});
