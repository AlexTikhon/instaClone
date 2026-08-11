import { describe, expect, it } from 'vitest';

import { MEDIA_UPLOADED_EVENT, mediaUploadedEventSchema } from './event-contracts';

describe('event contracts', () => {
  it('validates durable media event identity and correlation context', () => {
    const mediaId = crypto.randomUUID();
    expect(
      mediaUploadedEventSchema.parse({
        eventId: crypto.randomUUID(),
        eventName: MEDIA_UPLOADED_EVENT,
        eventVersion: 1,
        aggregateType: 'MediaAsset',
        aggregateId: mediaId,
        occurredAt: new Date().toISOString(),
        correlationId: 'request-123',
        payload: { mediaId, ownerId: crypto.randomUUID() },
      }).payload.mediaId,
    ).toBe(mediaId);
  });
});
