import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';

@Injectable()
export class CommentModerationPolicy {
  async remove(
    transaction: Prisma.TransactionClient,
    commentId: string,
    removedAt: Date,
  ): Promise<boolean> {
    const result = await transaction.comment.updateMany({
      where: { id: commentId, deletedAt: null, moderationRemovedAt: null },
      data: { moderationRemovedAt: removedAt },
    });
    return result.count === 1;
  }
}
