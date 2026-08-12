import { HttpStatus, Injectable } from '@nestjs/common';

import type {
  MarkAllNotificationsReadResponse,
  NotificationResponse,
  NotificationsQuery,
  NotificationsResponse,
  Profile,
} from '@instaclone/api-contracts';

import type { NotificationType } from '../generated/prisma/enums';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ApiError } from '../platform/errors/api-error';
import { decodeNotificationCursor, encodeNotificationCursor } from './notification-cursor';

interface NotificationView {
  id: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  actorId: string | null;
  actorUsername: string;
  actorDisplayName: string;
  postId: string | null;
  commentId: string | null;
  actor: { disabledAt: Date | null; profile: Profile | null } | null;
  post: {
    deletedAt: Date | null;
    moderationRemovedAt: Date | null;
    author: { disabledAt: Date | null };
  } | null;
  comment: {
    deletedAt: Date | null;
    moderationRemovedAt: Date | null;
    author: { disabledAt: Date | null };
  } | null;
}

const notificationInclude = {
  actor: { select: { disabledAt: true, profile: true } },
  post: {
    select: {
      deletedAt: true,
      moderationRemovedAt: true,
      author: { select: { disabledAt: true } },
    },
  },
  comment: {
    select: {
      deletedAt: true,
      moderationRemovedAt: true,
      author: { select: { disabledAt: true } },
    },
  },
} as const;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(recipientId: string, query: NotificationsQuery): Promise<NotificationsResponse> {
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : null;
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          recipientId,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: notificationInclude,
      }),
      this.prisma.notification.count({ where: { recipientId, readAt: null } }),
    ]);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      items: page.map((row) => this.toResponse(row)),
      nextCursor: last
        ? encodeNotificationCursor({ createdAt: last.createdAt, id: last.id })
        : null,
      hasMore,
      unreadCount,
    };
  }

  async markRead(recipientId: string, notificationId: string): Promise<NotificationResponse> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId },
      include: notificationInclude,
    });
    if (!existing) this.notFound();
    if (existing.readAt) return this.toResponse(existing);

    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    const updated = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId },
      include: notificationInclude,
    });
    if (!updated) this.notFound();
    return this.toResponse(updated);
  }

  async markAllRead(recipientId: string): Promise<MarkAllNotificationsReadResponse> {
    const readAt = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt },
    });
    return { readAt: readAt.toISOString(), updatedCount: result.count };
  }

  private toResponse(row: NotificationView): NotificationResponse {
    const actorAvailable = Boolean(row.actor && !row.actor.disabledAt && row.actor.profile);
    const contentAvailable =
      row.type === 'LIKE' || row.type === 'COMMENT'
        ? Boolean(
            row.post &&
            !row.post.deletedAt &&
            !row.post.moderationRemovedAt &&
            !row.post.author.disabledAt &&
            (row.type !== 'COMMENT' ||
              (row.comment &&
                !row.comment.deletedAt &&
                !row.comment.moderationRemovedAt &&
                !row.comment.author.disabledAt)),
          )
        : null;
    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      actor: {
        id: actorAvailable ? row.actorId : null,
        username: row.actorUsername,
        displayName: row.actorDisplayName,
        isAvailable: actorAvailable,
      },
      target: { postId: row.postId, commentId: row.commentId, contentAvailable },
    };
  }

  private notFound(): never {
    throw new ApiError(
      HttpStatus.NOT_FOUND,
      'NOTIFICATION_NOT_FOUND',
      'Notification was not found',
    );
  }
}
