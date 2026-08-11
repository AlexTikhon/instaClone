import type { Logger } from 'pino';

import {
  COMMENT_CREATED_EVENT,
  commentCreatedEventSchema,
  FOLLOW_REQUESTED_EVENT,
  followRequestedEventSchema,
  POST_LIKED_EVENT,
  postLikedEventSchema,
  USER_FOLLOWED_EVENT,
  userFollowedEventSchema,
  type EventEnvelope,
  type NotificationType,
} from '@instaclone/api-contracts';

import type {
  NotificationProjection,
  NotificationProjectionRepository,
} from './notification-projection.repository';
import type { NotificationRealtimePublisher } from './notification-realtime.publisher';

export interface NotificationProjectionResult {
  notificationId?: string;
  status: 'CREATED' | 'EXISTING' | 'SUPPRESSED';
}

export class NotificationProjector {
  constructor(
    private readonly repository: Pick<NotificationProjectionRepository, 'persist'>,
    private readonly realtime: Pick<NotificationRealtimePublisher, 'publish'>,
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
  ) {}

  async handle(input: unknown): Promise<NotificationProjectionResult> {
    const event = input as EventEnvelope;
    const projection = this.map(event);
    if (projection.actorId === projection.recipientId) {
      this.logger.info(
        {
          correlationId: event.correlationId,
          eventId: event.eventId,
          eventName: event.eventName,
          recipientId: projection.recipientId,
        },
        'self notification suppressed',
      );
      return { status: 'SUPPRESSED' };
    }

    const persisted = await this.repository.persist(projection);
    if (!persisted) return { status: 'SUPPRESSED' };

    this.logger.info(
      {
        correlationId: event.correlationId,
        eventId: event.eventId,
        eventName: event.eventName,
        notificationId: persisted.notification.id,
        recipientId: projection.recipientId,
      },
      persisted.created ? 'notification created' : 'notification delivery deduplicated',
    );

    try {
      await this.realtime.publish(projection.recipientId, persisted.notification);
    } catch (error) {
      this.logger.warn(
        {
          correlationId: event.correlationId,
          eventId: event.eventId,
          eventName: event.eventName,
          notificationId: persisted.notification.id,
          recipientId: projection.recipientId,
          error,
        },
        'notification realtime publish failed; durable notification remains available',
      );
    }
    return {
      notificationId: persisted.notification.id,
      status: persisted.created ? 'CREATED' : 'EXISTING',
    };
  }

  private map(event: EventEnvelope): NotificationProjection {
    switch (event.eventName) {
      case POST_LIKED_EVENT: {
        const parsed = postLikedEventSchema.parse(event);
        return this.projection(
          parsed,
          'LIKE',
          parsed.payload.actorId,
          parsed.payload.postAuthorId,
          {
            postId: parsed.payload.postId,
          },
        );
      }
      case COMMENT_CREATED_EVENT: {
        const parsed = commentCreatedEventSchema.parse(event);
        return this.projection(
          parsed,
          'COMMENT',
          parsed.payload.authorId,
          parsed.payload.postAuthorId,
          { postId: parsed.payload.postId, commentId: parsed.payload.commentId },
        );
      }
      case USER_FOLLOWED_EVENT: {
        const parsed = userFollowedEventSchema.parse(event);
        return this.projection(
          parsed,
          'FOLLOW',
          parsed.payload.actorId,
          parsed.payload.targetUserId,
        );
      }
      case FOLLOW_REQUESTED_EVENT: {
        const parsed = followRequestedEventSchema.parse(event);
        return this.projection(
          parsed,
          'FOLLOW_REQUEST',
          parsed.payload.requesterId,
          parsed.payload.targetUserId,
        );
      }
      default:
        throw new Error(`Event does not project a notification: ${event.eventName}`);
    }
  }

  private projection(
    event: EventEnvelope,
    type: NotificationType,
    actorId: string,
    recipientId: string,
    target: { postId?: string; commentId?: string } = {},
  ): NotificationProjection {
    return {
      sourceEventId: event.eventId,
      recipientId,
      actorId,
      type,
      postId: target.postId ?? null,
      commentId: target.commentId ?? null,
      createdAt: event.occurredAt,
    };
  }
}
