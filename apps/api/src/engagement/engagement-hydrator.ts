import { Injectable } from '@nestjs/common';

import type { FeedEngagement } from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class EngagementHydrator {
  async hydrate(viewerId: string, postIds: string[]): Promise<Map<string, FeedEngagement>> {
    if (postIds.length === 0) return new Map();
    const [likeCounts, commentCounts, viewerLikes, viewerSaves] = await Promise.all([
      this.prisma.postLike.groupBy({
        by: ['postId'],
        where: { postId: { in: postIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.comment.groupBy({
        by: ['postId'],
        where: {
          postId: { in: postIds },
          deletedAt: null,
          moderationRemovedAt: null,
          author: { disabledAt: null, profile: { isNot: null } },
        },
        _count: { _all: true },
      }),
      this.prisma.postLike.findMany({
        where: { userId: viewerId, postId: { in: postIds }, deletedAt: null },
        select: { postId: true },
      }),
      this.prisma.savedPost.findMany({
        where: { userId: viewerId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ]);
    const likes = new Map(likeCounts.map((row) => [row.postId, row._count._all]));
    const comments = new Map(commentCounts.map((row) => [row.postId, row._count._all]));
    const liked = new Set(viewerLikes.map((row) => row.postId));
    const saved = new Set(viewerSaves.map((row) => row.postId));
    return new Map(
      postIds.map((postId) => [
        postId,
        {
          likeCount: likes.get(postId) ?? 0,
          commentCount: comments.get(postId) ?? 0,
          viewerHasLiked: liked.has(postId),
          viewerHasSaved: saved.has(postId),
        },
      ]),
    );
  }

  constructor(private readonly prisma: PrismaService) {}
}
