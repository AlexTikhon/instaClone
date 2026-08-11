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
        const inserted = await transaction.postLike.createMany({
          data: [{ userId: viewerId, postId }],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
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
          likeCount: await transaction.postLike.count({ where: { postId } }),
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  unlike(viewerId: string, postId: string): Promise<LikeResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await this.access.requireInteractablePost(transaction, viewerId, postId);
      await transaction.postLike.deleteMany({ where: { userId: viewerId, postId } });
      return {
        liked: false,
        likeCount: await transaction.postLike.count({ where: { postId } }),
      };
    });
  }
}
