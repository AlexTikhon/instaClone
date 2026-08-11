import { describe, expect, it, vi } from 'vitest';

import type { EventEnvelope, NotificationResponse } from '@instaclone/api-contracts';

import { NotificationProjector } from './notification-projector';

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  recipient: '10000000-0000-4000-8000-000000000002',
  post: '10000000-0000-4000-8000-000000000003',
  comment: '10000000-0000-4000-8000-000000000004',
  event: '10000000-0000-4000-8000-000000000005',
};

const envelope = (
  eventName: string,
  aggregateType: string,
  aggregateId: string,
  payload: unknown,
): EventEnvelope => ({
  eventId: ids.event,
  eventName,
  eventVersion: 1,
  aggregateType,
  aggregateId,
  occurredAt: '2026-08-11T12:00:00.000Z',
  correlationId: 'request-1',
  payload,
});

const response: NotificationResponse = {
  id: '10000000-0000-4000-8000-000000000006',
  type: 'LIKE',
  createdAt: '2026-08-11T12:00:00.000Z',
  readAt: null,
  actor: { id: ids.actor, username: 'alex', displayName: 'Alex', isAvailable: true },
  target: { postId: ids.post, commentId: null, contentAvailable: true },
};

const setup = () => {
  const repository = {
    persist: vi.fn().mockResolvedValue({ created: true, notification: response }),
  };
  const realtime = { publish: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  return {
    repository,
    realtime,
    logger,
    projector: new NotificationProjector(repository, realtime, logger),
  };
};

describe('NotificationProjector', () => {
  it.each([
    [
      envelope('POST_LIKED', 'PostLike', ids.post, {
        postId: ids.post,
        postAuthorId: ids.recipient,
        actorId: ids.actor,
      }),
      {
        type: 'LIKE',
        actorId: ids.actor,
        recipientId: ids.recipient,
        postId: ids.post,
        commentId: null,
      },
    ],
    [
      envelope('COMMENT_CREATED', 'Comment', ids.comment, {
        commentId: ids.comment,
        postId: ids.post,
        postAuthorId: ids.recipient,
        authorId: ids.actor,
      }),
      {
        type: 'COMMENT',
        actorId: ids.actor,
        recipientId: ids.recipient,
        postId: ids.post,
        commentId: ids.comment,
      },
    ],
    [
      envelope('USER_FOLLOWED', 'Follow', ids.recipient, {
        actorId: ids.actor,
        targetUserId: ids.recipient,
      }),
      {
        type: 'FOLLOW',
        actorId: ids.actor,
        recipientId: ids.recipient,
        postId: null,
        commentId: null,
      },
    ],
    [
      envelope('FOLLOW_REQUESTED', 'FollowRequest', ids.recipient, {
        requesterId: ids.actor,
        targetUserId: ids.recipient,
      }),
      {
        type: 'FOLLOW_REQUEST',
        actorId: ids.actor,
        recipientId: ids.recipient,
        postId: null,
        commentId: null,
      },
    ],
  ])('maps %s to a user-facing notification consequence', async (event, expected) => {
    const { projector, repository, realtime } = setup();
    await expect(projector.handle(event)).resolves.toMatchObject({ status: 'CREATED' });
    expect(repository.persist).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(realtime.publish).toHaveBeenCalledWith(ids.recipient, response);
  });

  it.each(['POST_LIKED', 'COMMENT_CREATED'])(
    'suppresses self activity for %s',
    async (eventName) => {
      const { projector, repository, realtime } = setup();
      const event =
        eventName === 'POST_LIKED'
          ? envelope(eventName, 'PostLike', ids.post, {
              postId: ids.post,
              postAuthorId: ids.actor,
              actorId: ids.actor,
            })
          : envelope(eventName, 'Comment', ids.comment, {
              commentId: ids.comment,
              postId: ids.post,
              postAuthorId: ids.actor,
              authorId: ids.actor,
            });
      await expect(projector.handle(event)).resolves.toEqual({ status: 'SUPPRESSED' });
      expect(repository.persist).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    },
  );

  it('returns an existing row on redelivery and keeps realtime failure best-effort', async () => {
    const { projector, repository, realtime, logger } = setup();
    repository.persist.mockResolvedValue({ created: false, notification: response });
    realtime.publish.mockRejectedValue(new Error('redis unavailable'));
    const event = envelope('POST_LIKED', 'PostLike', ids.post, {
      postId: ids.post,
      postAuthorId: ids.recipient,
      actorId: ids.actor,
    });
    await expect(projector.handle(event)).resolves.toMatchObject({ status: 'EXISTING' });
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
