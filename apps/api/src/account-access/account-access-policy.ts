import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';

@Injectable()
export class AccountAccessPolicy {
  visibleWhere(viewerId: string): Prisma.UserWhereInput {
    return {
      disabledAt: null,
      profile: { isNot: null },
      outgoingBlocks: { none: { blockedId: viewerId } },
      incomingBlocks: { none: { blockerId: viewerId } },
    };
  }

  async suspend(
    transaction: Prisma.TransactionClient,
    userId: string,
    suspendedAt: Date,
  ): Promise<boolean> {
    const result = await transaction.user.updateMany({
      where: { id: userId, disabledAt: null },
      data: { disabledAt: suspendedAt },
    });
    if (result.count !== 1) return false;
    await transaction.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: suspendedAt, revokeReason: 'ACCOUNT_DISABLED' },
    });
    return true;
  }
}
