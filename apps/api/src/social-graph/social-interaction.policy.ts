import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';

export interface MessagingPairState {
  available: boolean;
  blocked: boolean;
}

@Injectable()
export class SocialInteractionPolicy {
  canonicalPair(firstUserId: string, secondUserId: string): readonly [string, string] {
    return firstUserId < secondUserId ? [firstUserId, secondUserId] : [secondUserId, firstUserId];
  }

  async lockPair(
    transaction: Prisma.TransactionClient,
    firstUserId: string,
    secondUserId: string,
  ): Promise<void> {
    const [lowerUserId, higherUserId] = this.canonicalPair(firstUserId, secondUserId);
    const key = `${lowerUserId}:${higherUserId}`;
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }

  async messagingPairState(
    transaction: Prisma.TransactionClient,
    firstUserId: string,
    secondUserId: string,
  ): Promise<MessagingPairState> {
    const users = await transaction.user.count({
      where: {
        id: { in: [firstUserId, secondUserId] },
        disabledAt: null,
        profile: { isNot: null },
      },
    });
    const blockCount = await transaction.block.count({
      where: {
        OR: [
          { blockerId: firstUserId, blockedId: secondUserId },
          { blockerId: secondUserId, blockedId: firstUserId },
        ],
      },
    });
    return { available: users === 2, blocked: blockCount > 0 };
  }
}
