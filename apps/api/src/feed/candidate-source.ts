import { Injectable } from '@nestjs/common';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import { postInclude, type PostView } from '../posts/posts.service';
import type { FeedCursor } from './feed-cursor';

@Injectable()
export class CandidateSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
  ) {}

  find(viewerId: string, limit: number, cursor: FeedCursor | null): Promise<PostView[]> {
    return this.prisma.post.findMany({
      where: {
        AND: [
          this.access.visibleWhere(viewerId),
          {
            OR: [
              { authorId: viewerId },
              { author: { incomingFollows: { some: { followerId: viewerId } } } },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.postId } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: postInclude,
    });
  }
}
