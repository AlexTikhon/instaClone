import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  MAX_ACTIVE_STORIES_PER_AUTHOR,
  STORY_CREATED_EVENT,
  type CreateStoryInput,
  type StoryAuthor,
  type StoryAuthorGroup,
  type StoryResponse,
  type StorySequenceResponse,
  type StoryTrayResponse,
  type StoryViewersQuery,
  type StoryViewersResponse,
  type StoryViewResponse,
} from '@instaclone/api-contracts';

import { Prisma, type MediaAssetStatus, type MediaKind } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { MediaService, type StoryMediaAsset } from '../media/media.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import { StoryAccessPolicy } from './story-access-policy';
import { compareStoryAuthorGroups, compareStoryPlayback } from './story-policy';
import { decodeStoryViewerCursor, encodeStoryViewerCursor } from './story-viewer-cursor';

const STORY_TRAY_AUTHOR_LIMIT = 100;

interface StoryReadRow {
  id: string;
  authorId: string;
  username: string;
  displayName: string;
  mediaId: string;
  mediaKind: MediaKind;
  mediaStatus: MediaAssetStatus;
  declaredMimeType: string;
  declaredSizeBytes: number;
  verifiedSizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  mediaCreatedAt: Date;
  mediaUpdatedAt: Date;
  thumbnailObjectKey: string | null;
  createdAt: Date;
  expiresAt: Date;
  viewerHasViewed: boolean;
}

interface TrayRow {
  authorId: string;
  username: string;
  displayName: string;
  isViewer: boolean;
  hasUnseenStories: boolean;
  storyCount: bigint;
  latestStoryAt: Date;
}

interface ViewerRow {
  viewerId: string;
  username: string;
  displayName: string;
  viewedAt: Date;
}

@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly access: StoryAccessPolicy,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StoriesService.name);
  }

  async create(
    authorId: string,
    input: CreateStoryInput,
    correlationId: string,
  ): Promise<StoryResponse> {
    await this.media.requireOwnedReadyForStory(authorId, input.mediaAssetId);
    const storyId = randomUUID();
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${authorId}, 0))`;
      const counts = await transaction.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM stories
        WHERE "authorId" = ${authorId}::uuid
          AND "deletedAt" IS NULL
          AND "expiresAt" > CURRENT_TIMESTAMP
      `;
      if (Number(counts[0]?.count ?? 0) >= MAX_ACTIVE_STORIES_PER_AUTHOR) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'STORY_LIMIT_REACHED',
          `An account may have at most ${MAX_ACTIVE_STORIES_PER_AUTHOR} active Stories`,
        );
      }
      const rows = await transaction.$queryRaw<{ createdAt: Date; expiresAt: Date }[]>`
        INSERT INTO stories (id, "authorId", "mediaAssetId", "createdAt", "expiresAt")
        VALUES (
          ${storyId}::uuid,
          ${authorId}::uuid,
          ${input.mediaAssetId}::uuid,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP + INTERVAL '24 hours'
        )
        RETURNING "createdAt", "expiresAt"
      `;
      const inserted = rows[0];
      if (!inserted) throw new Error('Story insert did not return a row');
      const event = createOutboxEvent({
        eventName: STORY_CREATED_EVENT,
        aggregateType: 'Story',
        aggregateId: storyId,
        correlationId,
        occurredAt: inserted.createdAt,
        payload: {
          storyId,
          authorId,
          mediaAssetId: input.mediaAssetId,
          expiresAt: inserted.expiresAt.toISOString(),
        },
      });
      await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
      return inserted;
    });
    this.logger.info(
      { storyId, authorId, correlationId, expiresAt: created.expiresAt.toISOString() },
      'story created',
    );
    return this.get(authorId, storyId);
  }

  async tray(viewerId: string): Promise<StoryTrayResponse> {
    const rows = await this.prisma.$queryRaw<TrayRow[]>(Prisma.sql`
      SELECT
        story."authorId" AS "authorId",
        profile.username,
        profile."displayName" AS "displayName",
        story."authorId" = ${viewerId}::uuid AS "isViewer",
        CASE
          WHEN story."authorId" = ${viewerId}::uuid THEN FALSE
          ELSE BOOL_OR(story_view."storyId" IS NULL)
        END AS "hasUnseenStories",
        COUNT(*) AS "storyCount",
        MAX(story."createdAt") AS "latestStoryAt"
      FROM stories story
      JOIN users author ON author.id = story."authorId"
      JOIN profiles profile ON profile."userId" = author.id
      LEFT JOIN story_views story_view
        ON story_view."storyId" = story.id AND story_view."viewerId" = ${viewerId}::uuid
      WHERE ${this.access.activeStory()}
        AND ${this.access.visibleAuthor(viewerId)}
        AND ${this.access.selfOrFollowed(viewerId)}
      GROUP BY story."authorId", profile.username, profile."displayName"
      ORDER BY "hasUnseenStories" DESC, "latestStoryAt" DESC, story."authorId" DESC
      LIMIT ${STORY_TRAY_AUTHOR_LIMIT}
    `);
    const groups = rows.map((row): StoryAuthorGroup => ({
      author: this.toAuthor(row),
      isViewer: row.isViewer,
      hasUnseenStories: row.hasUnseenStories,
      storyCount: Number(row.storyCount),
      latestStoryAt: row.latestStoryAt.toISOString(),
    }));
    groups.sort(compareStoryAuthorGroups);
    return { groups };
  }

  async sequence(viewerId: string, authorId: string): Promise<StorySequenceResponse> {
    const rows = await this.readStories(
      Prisma.sql`
      story."authorId" = ${authorId}::uuid
      AND ${this.access.activeStory()}
      AND ${this.access.visibleAuthor(viewerId)}
      ORDER BY story."createdAt" ASC, story.id ASC
      LIMIT ${MAX_ACTIVE_STORIES_PER_AUTHOR}
    `,
      viewerId,
    );
    if (rows.length === 0) this.notFound();
    rows.sort(compareStoryPlayback);
    return {
      author: this.toAuthor(rows[0]!),
      stories: await Promise.all(rows.map((row) => this.toResponse(row))),
    };
  }

  async get(viewerId: string, storyId: string): Promise<StoryResponse> {
    const rows = await this.readStories(
      Prisma.sql`
      story.id = ${storyId}::uuid
      AND ${this.access.activeStory()}
      AND ${this.access.visibleAuthor(viewerId)}
      LIMIT 1
    `,
      viewerId,
    );
    const row = rows[0];
    if (!row) this.notFound();
    return this.toResponse(row);
  }

  async recordView(viewerId: string, storyId: string): Promise<StoryViewResponse> {
    const rows = await this.prisma.$queryRaw<
      { authorId: string; viewedAt: Date | null }[]
    >(Prisma.sql`
      WITH eligible AS (
        SELECT story.id, story."authorId"
        FROM stories story
        JOIN users author ON author.id = story."authorId"
        JOIN profiles profile ON profile."userId" = author.id
        WHERE story.id = ${storyId}::uuid
          AND ${this.access.activeStory()}
          AND ${this.access.visibleAuthor(viewerId)}
        FOR SHARE OF story
      ), inserted AS (
        INSERT INTO story_views ("storyId", "viewerId", "viewedAt")
        SELECT eligible.id, ${viewerId}::uuid, CURRENT_TIMESTAMP
        FROM eligible
        WHERE eligible."authorId" <> ${viewerId}::uuid
        ON CONFLICT ("storyId", "viewerId")
        DO UPDATE SET "viewedAt" = story_views."viewedAt"
        RETURNING "viewedAt"
      )
      SELECT
        eligible."authorId" AS "authorId",
        COALESCE(
          (SELECT "viewedAt" FROM inserted),
          existing."viewedAt"
        ) AS "viewedAt"
      FROM eligible
      LEFT JOIN story_views existing
        ON existing."storyId" = eligible.id AND existing."viewerId" = ${viewerId}::uuid
    `);
    const row = rows[0];
    if (!row) this.notFound();
    const recorded = row.authorId !== viewerId;
    this.logger.info({ storyId, viewerId, recorded }, 'story view processed');
    return { storyId, recorded, viewedAt: row.viewedAt?.toISOString() ?? null };
  }

  async delete(authorId: string, storyId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE stories
      SET "deletedAt" = CURRENT_TIMESTAMP
      WHERE id = ${storyId}::uuid
        AND "authorId" = ${authorId}::uuid
        AND "deletedAt" IS NULL
      RETURNING id
    `;
    if (rows.length === 0) this.notFound();
  }

  async viewers(
    authorId: string,
    storyId: string,
    query: StoryViewersQuery,
  ): Promise<StoryViewersResponse> {
    const owned = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM stories WHERE id = ${storyId}::uuid AND "authorId" = ${authorId}::uuid
    `;
    if (owned.length === 0) this.notFound();
    const cursor = query.cursor ? decodeStoryViewerCursor(query.cursor) : null;
    const rows = await this.prisma.$queryRaw<ViewerRow[]>(Prisma.sql`
      SELECT
        story_view."viewerId" AS "viewerId",
        profile.username,
        profile."displayName" AS "displayName",
        story_view."viewedAt" AS "viewedAt"
      FROM story_views story_view
      JOIN users viewer ON viewer.id = story_view."viewerId" AND viewer."disabledAt" IS NULL
      JOIN profiles profile ON profile."userId" = viewer.id
      WHERE story_view."storyId" = ${storyId}::uuid
        ${
          cursor
            ? Prisma.sql`AND (
          story_view."viewedAt" < ${cursor.viewedAt}
          OR (story_view."viewedAt" = ${cursor.viewedAt} AND story_view."viewerId" < ${cursor.viewerId}::uuid)
        )`
            : Prisma.empty
        }
      ORDER BY story_view."viewedAt" DESC, story_view."viewerId" DESC
      LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      viewers: page.map((row) => ({
        user: this.toAuthor({
          authorId: row.viewerId,
          username: row.username,
          displayName: row.displayName,
        }),
        viewedAt: row.viewedAt.toISOString(),
      })),
      nextCursor: last
        ? encodeStoryViewerCursor({ viewedAt: last.viewedAt, viewerId: last.viewerId })
        : null,
      hasMore,
    };
  }

  private readStories(where: Prisma.Sql, viewerId: string): Promise<StoryReadRow[]> {
    return this.prisma.$queryRaw<StoryReadRow[]>(Prisma.sql`
      SELECT
        story.id,
        story."authorId" AS "authorId",
        profile.username,
        profile."displayName" AS "displayName",
        media.id AS "mediaId",
        media.kind AS "mediaKind",
        media.status AS "mediaStatus",
        media."declaredMimeType" AS "declaredMimeType",
        media."declaredSizeBytes" AS "declaredSizeBytes",
        media."verifiedSizeBytes" AS "verifiedSizeBytes",
        media.width,
        media.height,
        media."durationMs" AS "durationMs",
        media."createdAt" AS "mediaCreatedAt",
        media."updatedAt" AS "mediaUpdatedAt",
        media."thumbnailObjectKey" AS "thumbnailObjectKey",
        story."createdAt" AS "createdAt",
        story."expiresAt" AS "expiresAt",
        (
          story."authorId" = ${viewerId}::uuid
          OR EXISTS (
            SELECT 1 FROM story_views story_view
            WHERE story_view."storyId" = story.id AND story_view."viewerId" = ${viewerId}::uuid
          )
        ) AS "viewerHasViewed"
      FROM stories story
      JOIN users author ON author.id = story."authorId"
      JOIN profiles profile ON profile."userId" = author.id
      JOIN media_assets media ON media.id = story."mediaAssetId" AND media.status = 'READY'
      WHERE ${where}
    `);
  }

  private async toResponse(row: StoryReadRow): Promise<StoryResponse> {
    const mediaAsset: StoryMediaAsset = {
      id: row.mediaId,
      kind: row.mediaKind,
      status: row.mediaStatus,
      declaredMimeType: row.declaredMimeType,
      declaredSizeBytes: row.declaredSizeBytes,
      verifiedSizeBytes: row.verifiedSizeBytes,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      createdAt: row.mediaCreatedAt,
      updatedAt: row.mediaUpdatedAt,
      thumbnailObjectKey: row.thumbnailObjectKey,
    };
    return {
      id: row.id,
      author: this.toAuthor(row),
      media: await this.media.toResponse(mediaAsset),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      viewerHasViewed: row.viewerHasViewed,
    };
  }

  private toAuthor(row: { authorId: string; username: string; displayName: string }): StoryAuthor {
    return { id: row.authorId, username: row.username, displayName: row.displayName };
  }

  private notFound(): never {
    throw new ApiError(HttpStatus.NOT_FOUND, 'STORY_NOT_FOUND', 'Story was not found');
  }
}
