import { describe, expect, it } from 'vitest';

import {
  FOLLOW_REQUESTED_EVENT,
  followRequestedEventSchema,
  MEDIA_UPLOADED_EVENT,
  mediaUploadedEventSchema,
  USER_FOLLOWED_EVENT,
  userFollowedEventSchema,
} from './event-contracts';

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

  it('keeps follow facts versioned and presentation-free', () => {
    const actorId = crypto.randomUUID();
    const targetUserId = crypto.randomUUID();
    const envelope = {
      eventId: crypto.randomUUID(),
      eventVersion: 1,
      aggregateId: targetUserId,
      occurredAt: new Date().toISOString(),
      correlationId: 'follow-request',
    };
    expect(
      userFollowedEventSchema.parse({
        ...envelope,
        eventName: USER_FOLLOWED_EVENT,
        aggregateType: 'Follow',
        payload: { actorId, targetUserId },
      }).payload,
    ).toEqual({ actorId, targetUserId });
    expect(
      followRequestedEventSchema.parse({
        ...envelope,
        eventName: FOLLOW_REQUESTED_EVENT,
        aggregateType: 'FollowRequest',
        payload: { requesterId: actorId, targetUserId },
      }).payload.requesterId,
    ).toBe(actorId);
  });
});
