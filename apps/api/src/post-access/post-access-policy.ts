import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { ApiError } from '../platform/errors/api-error';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PostAccessPolicy {
  visibleWhere(viewerId: string): Prisma.PostWhereInput {
    return {
      deletedAt: null,
      author: {
        disabledAt: null,
        profile: { isNot: null },
        outgoingBlocks: { none: { blockedId: viewerId } },
        incomingBlocks: { none: { blockerId: viewerId } },
      },
      OR: [
        { authorId: viewerId },
        { author: { profile: { is: { isPrivate: false } } } },
        { author: { incomingFollows: { some: { followerId: viewerId } } } },
      ],
    };
  }

  /**
   * Raw-SQL equivalent of visibleWhere for ranked candidate queries. Callers must use the fixed
   * aliases `p` (posts), `u` (users), and `pr` (profiles). Hydration reapplies visibleWhere as a
   * defense in depth check.
   */
  visibleSql(viewerId: string): Prisma.Sql {
    return Prisma.sql`
      p."deletedAt" IS NULL
      AND u."disabledAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b."blockerId" = ${viewerId}::uuid AND b."blockedId" = p."authorId")
           OR (b."blockerId" = p."authorId" AND b."blockedId" = ${viewerId}::uuid)
      )
      AND (
        p."authorId" = ${viewerId}::uuid
        OR pr."isPrivate" = false
        OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f."followerId" = ${viewerId}::uuid AND f."followingId" = p."authorId"
        )
      )
    `;
  }

  async requireInteractablePost(
    database: DatabaseClient,
    viewerId: string,
    postId: string,
  ): Promise<{ id: string; authorId: string }> {
    const locked = await database.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM posts WHERE id = ${postId}::uuid FOR SHARE`,
    );
    if (locked.length === 0) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Post was not found');
    }
    return this.requireVisiblePost(database, viewerId, postId);
  }

  async requireVisiblePost(
    database: DatabaseClient,
    viewerId: string,
    postId: string,
  ): Promise<{ id: string; authorId: string }> {
    const post = await database.post.findFirst({
      where: { id: postId, ...this.visibleWhere(viewerId) },
      select: { id: true, authorId: true },
    });
    if (!post) throw new ApiError(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Post was not found');
    return post;
  }
}
