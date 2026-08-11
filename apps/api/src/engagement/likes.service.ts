import { Injectable } from '@nestjs/common';

import { POST_LIKED_EVENT, type LikeResponse } from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { PostAccessPolicy } from '../post-access/post-access-policy';

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
  ) {}

  like(viewerId: string, postId: string, correlationId: string): Promise<LikeResponse> {
    return this.prisma.$transaction(
      async (transaction) => {
        const post = await this.access.requireInteractablePost(transaction, viewerId, postId);
        const restored = await transaction.postLike.updateMany({
          where: { userId: viewerId, postId, deletedAt: { not: null } },
          data: { deletedAt: null, createdAt: new Date() },
        });
        const inserted =
          restored.count === 0
            ? await transaction.postLike.createMany({
                data: [{ userId: viewerId, postId }],
                skipDuplicates: true,
              })
            : { count: 0 };
        if (restored.count === 1 || inserted.count === 1) {
          const event = createOutboxEvent({
            eventName: POST_LIKED_EVENT,
            aggregateType: 'PostLike',
            aggregateId: postId,
            correlationId,
            payload: { postId, postAuthorId: post.authorId, actorId: viewerId },
          });
          await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
        }
        return {
          liked: true,
          likeCount: await transaction.postLike.count({ where: { postId, deletedAt: null } }),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  unlike(viewerId: string, postId: string): Promise<LikeResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await this.access.requireInteractablePost(transaction, viewerId, postId);
      await transaction.postLike.updateMany({
        where: { userId: viewerId, postId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return {
        liked: false,
        likeCount: await transaction.postLike.count({ where: { postId, deletedAt: null } }),
      };
    });
  }
}
