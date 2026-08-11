import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { EventEnvelope } from '@instaclone/api-contracts';

import { NotificationProjectionRepository } from './notification-projection.repository';
import { NotificationProjector } from './notification-projector';

const postgresEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(postgresEnabled)('notification projection PostgreSQL integration', () => {
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    max: 8,
  });
  const actorId = randomUUID();
  const recipientId = randomUUID();
  const postId = randomUUID();
  const commentId = randomUUID();
  const realtime = { publish: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const projector = new NotificationProjector(
    new NotificationProjectionRepository(pool),
    realtime,
    logger,
  );

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO users (id, email, "updatedAt") VALUES
         ($1, $2, CURRENT_TIMESTAMP), ($3, $4, CURRENT_TIMESTAMP)`,
      [
        actorId,
        `actor-${actorId}@example.com`,
        recipientId,
        `recipient-${recipientId}@example.com`,
      ],
    );
    await pool.query(
      `INSERT INTO profiles ("userId", username, "displayName", "updatedAt") VALUES
         ($1, $2, 'Actor', CURRENT_TIMESTAMP), ($3, $4, 'Recipient', CURRENT_TIMESTAMP)`,
      [
        actorId,
        `actor_${actorId.replaceAll('-', '').slice(0, 12)}`,
        recipientId,
        `recipient_${recipientId.replaceAll('-', '').slice(0, 12)}`,
      ],
    );
    await pool.query(
      `INSERT INTO posts (id, "authorId", caption, "updatedAt")
       VALUES ($1, $2, '', CURRENT_TIMESTAMP)`,
      [postId, recipientId],
    );
    await pool.query(
      `INSERT INTO comments (id, "postId", "authorId", body, "updatedAt")
       VALUES ($1, $2, $3, 'hello', CURRENT_TIMESTAMP)`,
      [commentId, postId, actorId],
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM notifications WHERE "recipientId" = $1', [recipientId]);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [actorId, recipientId]);
    await pool.end();
  });

  const event = (
    eventName: string,
    aggregateType: string,
    aggregateId: string,
    payload: unknown,
    eventId = randomUUID(),
  ): EventEnvelope => ({
    eventId,
    eventName,
    eventVersion: 1,
    aggregateType,
    aggregateId,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    payload,
  });

  it('creates one LIKE notification under sequential and concurrent duplicate delivery', async () => {
    const liked = event('POST_LIKED', 'PostLike', postId, {
      postId,
      postAuthorId: recipientId,
      actorId,
    });
    await Promise.all([projector.handle(liked), projector.handle(liked), projector.handle(liked)]);
    expect(
      Number(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*) AS count FROM notifications WHERE "sourceEventId" = $1',
            [liked.eventId],
          )
        ).rows[0]?.count,
      ),
    ).toBe(1);
  });

  it('creates COMMENT, FOLLOW, and FOLLOW_REQUEST projections for the intended recipient', async () => {
    await projector.handle(
      event('COMMENT_CREATED', 'Comment', commentId, {
        commentId,
        postId,
        postAuthorId: recipientId,
        authorId: actorId,
      }),
    );
    await projector.handle(
      event('USER_FOLLOWED', 'Follow', recipientId, { actorId, targetUserId: recipientId }),
    );
    await projector.handle(
      event('FOLLOW_REQUESTED', 'FollowRequest', recipientId, {
        requesterId: actorId,
        targetUserId: recipientId,
      }),
    );
    const result = await pool.query<{ type: string; recipientId: string }>(
      `SELECT type, "recipientId" FROM notifications WHERE "recipientId" = $1 ORDER BY type`,
      [recipientId],
    );
    expect(result.rows.map((row) => row.type).sort()).toEqual([
      'COMMENT',
      'FOLLOW',
      'FOLLOW_REQUEST',
    ]);
    expect(result.rows.every((row) => row.recipientId === recipientId)).toBe(true);
  });

  it('creates no notification for a self-like or self-comment', async () => {
    await projector.handle(
      event('POST_LIKED', 'PostLike', postId, {
        postId,
        postAuthorId: actorId,
        actorId,
      }),
    );
    await projector.handle(
      event('COMMENT_CREATED', 'Comment', commentId, {
        commentId,
        postId,
        postAuthorId: actorId,
        authorId: actorId,
      }),
    );
    expect(
      Number(
        (await pool.query<{ count: string }>('SELECT count(*) AS count FROM notifications')).rows[0]
          ?.count,
      ),
    ).toBe(0);
  });
});
