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
