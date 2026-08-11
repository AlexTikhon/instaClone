import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import type { NotificationResponse, NotificationType } from '@instaclone/api-contracts';

export interface NotificationProjection {
  sourceEventId: string;
  recipientId: string;
  actorId: string;
  type: NotificationType;
  postId: string | null;
  commentId: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  actorId: string | null;
  actorUsername: string;
  actorDisplayName: string;
  actorAvailable: boolean;
  postId: string | null;
  commentId: string | null;
  contentAvailable: boolean | null;
}

export interface PersistedNotification {
  created: boolean;
  notification: NotificationResponse;
}

export class NotificationProjectionRepository {
  constructor(private readonly pool: Pool) {}

  async persist(projection: NotificationProjection): Promise<PersistedNotification | null> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO notifications (
         id, "sourceEventId", "recipientId", "actorId", type, "postId", "commentId",
         "actorUsername", "actorDisplayName", "createdAt"
       )
       SELECT $1, $2, recipient.id, actor.id, $5::"NotificationType",
              (SELECT id FROM posts WHERE id = $6),
              (SELECT id FROM comments WHERE id = $7),
              COALESCE(profile.username, 'unavailable'),
              COALESCE(profile."displayName", 'Unavailable account'),
              $8::timestamptz
       FROM users recipient
       LEFT JOIN users actor ON actor.id = $4
       LEFT JOIN profiles profile ON profile."userId" = actor.id
       WHERE recipient.id = $3
       ON CONFLICT ("sourceEventId") DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        projection.sourceEventId,
        projection.recipientId,
        projection.actorId,
        projection.type,
        projection.postId,
        projection.commentId,
        projection.createdAt,
      ],
    );
    const row = await this.findBySourceEventId(projection.sourceEventId);
    return row ? { created: inserted.rowCount === 1, notification: this.toResponse(row) } : null;
  }

  private async findBySourceEventId(sourceEventId: string): Promise<NotificationRow | null> {
    const result = await this.pool.query<NotificationRow>(
      `SELECT n.id, n.type, n."createdAt", n."readAt", n."actorId",
              n."actorUsername", n."actorDisplayName",
              (actor.id IS NOT NULL AND actor."disabledAt" IS NULL AND profile."userId" IS NOT NULL)
                AS "actorAvailable",
              n."postId", n."commentId",
              CASE
                WHEN n.type IN ('LIKE', 'COMMENT') THEN
                  post.id IS NOT NULL AND post."deletedAt" IS NULL AND
                  (n.type <> 'COMMENT' OR (comment.id IS NOT NULL AND comment."deletedAt" IS NULL))
                ELSE NULL
              END AS "contentAvailable"
       FROM notifications n
       LEFT JOIN users actor ON actor.id = n."actorId"
       LEFT JOIN profiles profile ON profile."userId" = actor.id
       LEFT JOIN posts post ON post.id = n."postId"
       LEFT JOIN comments comment ON comment.id = n."commentId"
       WHERE n."sourceEventId" = $1`,
      [sourceEventId],
    );
    return result.rows[0] ?? null;
  }

  private toResponse(row: NotificationRow): NotificationResponse {
    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      actor: {
        id: row.actorAvailable ? row.actorId : null,
        username: row.actorUsername,
        displayName: row.actorDisplayName,
        isAvailable: row.actorAvailable,
      },
      target: {
        postId: row.postId,
        commentId: row.commentId,
        contentAvailable: row.contentAvailable,
      },
    };
  }
}
