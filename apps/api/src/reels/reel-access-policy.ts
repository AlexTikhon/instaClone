import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { ApiError } from '../platform/errors/api-error';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ReelAccessPolicy {
  visibleWhere(viewerId: string): Prisma.ReelWhereInput {
    return {
      deletedAt: null,
      moderationRemovedAt: null,
      mediaAsset: { is: { kind: 'VIDEO', status: 'READY', processingVersion: { not: null } } },
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

  async requireVisible(
    database: DatabaseClient,
    viewerId: string,
    reelId: string,
  ): Promise<{ id: string; mediaAssetId: string; authorId: string }> {
    const reel = await database.reel.findFirst({
      where: { id: reelId, ...this.visibleWhere(viewerId) },
      select: { id: true, mediaAssetId: true, authorId: true },
    });
    if (!reel) throw new ApiError(HttpStatus.NOT_FOUND, 'REEL_NOT_FOUND', 'Reel was not found');
    return reel;
  }

  async removeByModeration(
    database: DatabaseClient,
    reelId: string,
    removedAt: Date,
  ): Promise<boolean> {
    const result = await database.reel.updateMany({
      where: { id: reelId, deletedAt: null, moderationRemovedAt: null },
      data: { moderationRemovedAt: removedAt },
    });
    return result.count === 1;
  }
}
