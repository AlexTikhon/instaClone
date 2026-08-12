import { Injectable } from '@nestjs/common';

import type { SearchRelationshipState } from '@instaclone/api-contracts';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import type { SearchRepository } from './search.repository';
import {
  escapeLikePattern,
  EXPLORE_COMMENT_WEIGHT,
  EXPLORE_FRESHNESS_HOURS,
  EXPLORE_LIKE_WEIGHT,
  EXPLORE_WINDOW_DAYS,
  USER_SEARCH_RANK,
} from './search-ranking';
import type {
  ExploreCandidate,
  ExploreCursor,
  SearchUserCandidate,
  SearchUserCursor,
} from './search.types';

interface RawSearchUser {
  userId: string;
  username: string;
  normalizedUsername: string;
  displayName: string;
  isPrivate: boolean;
  relationship: SearchRelationshipState;
  rank: number;
}

interface RawExploreCandidate {
  postId: string;
  score: number;
  createdAt: Date;
  snapshotAt: Date;
}

@Injectable()
export class PrismaSearchRepository implements SearchRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
  ) {}

  searchUsers(
    viewerId: string,
    query: string,
    limit: number,
    cursor: SearchUserCursor | null,
  ): Promise<SearchUserCandidate[]> {
    const escaped = escapeLikePattern(query);
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const cursorFilter = cursor
      ? Prisma.sql`
          AND (
            ranked.rank > ${cursor.rank}
            OR (ranked.rank = ${cursor.rank} AND ranked."normalizedUsername" > ${cursor.normalizedUsername})
            OR (
              ranked.rank = ${cursor.rank}
              AND ranked."normalizedUsername" = ${cursor.normalizedUsername}
              AND ranked."userId" > ${cursor.userId}::uuid
            )
          )
        `
      : Prisma.empty;

    return this.prisma.$queryRaw<RawSearchUser[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          pr."userId" AS "userId",
          pr.username,
          lower(pr.username) AS "normalizedUsername",
          pr."displayName",
          pr."isPrivate",
          CASE
            WHEN pr."userId" = ${viewerId}::uuid THEN 'self'
            WHEN EXISTS (
              SELECT 1 FROM follows f
              WHERE f."followerId" = ${viewerId}::uuid AND f."followingId" = pr."userId"
            ) THEN 'following'
            WHEN EXISTS (
              SELECT 1 FROM follow_requests fr
              WHERE fr."requesterId" = ${viewerId}::uuid AND fr."targetId" = pr."userId"
            ) THEN 'requested'
            ELSE 'none'
          END AS relationship,
          CASE
            WHEN lower(pr.username) = ${query} THEN ${USER_SEARCH_RANK.exactUsername}
            WHEN lower(pr.username) LIKE ${prefix} ESCAPE '\' THEN ${USER_SEARCH_RANK.usernamePrefix}
            WHEN lower(pr."displayName") = ${query} THEN ${USER_SEARCH_RANK.exactDisplayName}
            WHEN lower(pr."displayName") LIKE ${prefix} ESCAPE '\' THEN ${USER_SEARCH_RANK.displayNamePrefix}
            WHEN lower(pr.username) LIKE ${contains} ESCAPE '\' THEN ${USER_SEARCH_RANK.usernameContains}
            ELSE ${USER_SEARCH_RANK.displayNameContains}
          END::integer AS rank
        FROM profiles pr
        JOIN users u ON u.id = pr."userId"
        WHERE u."disabledAt" IS NULL
          AND (
            lower(pr.username) LIKE ${contains} ESCAPE '\'
            OR lower(pr."displayName") LIKE ${contains} ESCAPE '\'
          )
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b."blockerId" = ${viewerId}::uuid AND b."blockedId" = pr."userId")
               OR (b."blockerId" = pr."userId" AND b."blockedId" = ${viewerId}::uuid)
          )
      )
      SELECT
        ranked."userId",
        ranked.username,
        ranked."normalizedUsername",
        ranked."displayName",
        ranked."isPrivate",
        ranked.relationship,
        ranked.rank
      FROM ranked
      WHERE true
      ${cursorFilter}
      ORDER BY ranked.rank ASC, ranked."normalizedUsername" ASC, ranked."userId" ASC
      LIMIT ${limit}
    `);
  }

  findExploreCandidates(
    viewerId: string,
    limit: number,
    cursor: ExploreCursor | null,
  ): Promise<ExploreCandidate[]> {
    const snapshotAt = cursor?.snapshotAt ?? null;
    const cursorFilter = cursor
      ? Prisma.sql`
          WHERE ranked.score < ${cursor.score}
             OR (ranked.score = ${cursor.score} AND ranked."createdAt" < ${cursor.createdAt})
             OR (
               ranked.score = ${cursor.score}
               AND ranked."createdAt" = ${cursor.createdAt}
               AND ranked."postId" < ${cursor.postId}::uuid
             )
        `
      : Prisma.empty;

    return this.prisma.$queryRaw<RawExploreCandidate[]>(Prisma.sql`
      WITH params AS (
        SELECT COALESCE(${snapshotAt}::timestamptz, CURRENT_TIMESTAMP) AS snapshot_at
      ),
      ranked AS (
        SELECT
          p.id AS "postId",
          p."createdAt",
          params.snapshot_at AS "snapshotAt",
          (
            LEAST(COALESCE(likes.like_count, 0), 10000) * ${EXPLORE_LIKE_WEIGHT}
            + LEAST(COALESCE(comments.comment_count, 0), 10000) * ${EXPLORE_COMMENT_WEIGHT}
            + GREATEST(
                0,
                ${EXPLORE_FRESHNESS_HOURS}
                - FLOOR(EXTRACT(EPOCH FROM (params.snapshot_at - p."createdAt")) / 3600)::integer
              )
          )::integer AS score
        FROM posts p
        JOIN users u ON u.id = p."authorId"
        JOIN profiles pr ON pr."userId" = u.id
        CROSS JOIN params
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::integer AS like_count
          FROM post_likes pl
          WHERE pl."postId" = p.id
            AND pl."createdAt" <= params.snapshot_at
            AND (pl."deletedAt" IS NULL OR pl."deletedAt" > params.snapshot_at)
        ) likes ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::integer AS comment_count
          FROM comments c
          JOIN users cu ON cu.id = c."authorId" AND cu."disabledAt" IS NULL
          JOIN profiles cp ON cp."userId" = cu.id
          WHERE c."postId" = p.id
            AND c."createdAt" <= params.snapshot_at
            AND (c."deletedAt" IS NULL OR c."deletedAt" > params.snapshot_at)
            AND c."moderationRemovedAt" IS NULL
        ) comments ON true
        WHERE ${this.access.visibleSql(viewerId)}
          AND p."authorId" <> ${viewerId}::uuid
          AND p."createdAt" <= params.snapshot_at
          AND p."createdAt" >= params.snapshot_at - (${EXPLORE_WINDOW_DAYS} * interval '1 day')
          AND EXISTS (
            SELECT 1
            FROM post_media pm
            JOIN media_assets ma ON ma.id = pm."mediaAssetId"
            WHERE pm."postId" = p.id
              AND ma.status = 'READY'
              AND ma."thumbnailObjectKey" IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM post_media pm
            JOIN media_assets ma ON ma.id = pm."mediaAssetId"
            WHERE pm."postId" = p.id
              AND (ma.status <> 'READY' OR ma."thumbnailObjectKey" IS NULL)
          )
      )
      SELECT ranked."postId", ranked.score, ranked."createdAt", ranked."snapshotAt"
      FROM ranked
      ${cursorFilter}
      ORDER BY ranked.score DESC, ranked."createdAt" DESC, ranked."postId" DESC
      LIMIT ${limit}
    `);
  }
}
