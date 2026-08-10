import { Injectable } from '@nestjs/common';

import type { Profile } from '@instaclone/api-contracts';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { SocialGraphRepository } from './social-graph.repository';
import type {
  AcceptRequestResult,
  BlockResult,
  FollowResult,
  IncomingFollowRequest,
} from './social-graph.types';

const toProfile = (profile: Profile): Profile => ({
  userId: profile.userId,
  username: profile.username,
  displayName: profile.displayName,
  bio: profile.bio,
  websiteUrl: profile.websiteUrl,
  isPrivate: profile.isPrivate,
});

@Injectable()
export class PrismaSocialGraphRepository implements SocialGraphRepository {
  constructor(private readonly prisma: PrismaService) {}

  follow(actorId: string, targetId: string): Promise<FollowResult> {
    if (actorId === targetId) return Promise.resolve('self');
    return this.runSerializable(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id: targetId },
        include: { profile: true },
      });
      if (!target?.profile || target.disabledAt) return 'not_found';
      if (await this.hasBlock(transaction, actorId, targetId)) return 'blocked';

      const existingFollow = await transaction.follow.findUnique({
        where: { followerId_followingId: { followerId: actorId, followingId: targetId } },
      });
      if (existingFollow) return 'following';

      if (target.profile.isPrivate) {
        await transaction.followRequest.upsert({
          where: { requesterId_targetId: { requesterId: actorId, targetId } },
          create: { requesterId: actorId, targetId },
          update: {},
        });
        return 'requested';
      }

      await transaction.follow.upsert({
        where: { followerId_followingId: { followerId: actorId, followingId: targetId } },
        create: { followerId: actorId, followingId: targetId },
        update: {},
      });
      await transaction.followRequest.deleteMany({ where: { requesterId: actorId, targetId } });
      return 'following';
    });
  }

  async unfollow(actorId: string, targetId: string): Promise<void> {
    await this.runSerializable(async (transaction) => {
      await transaction.follow.deleteMany({
        where: { followerId: actorId, followingId: targetId },
      });
      await transaction.followRequest.deleteMany({ where: { requesterId: actorId, targetId } });
    });
  }

  async listIncomingRequests(targetId: string): Promise<IncomingFollowRequest[]> {
    const requests = await this.prisma.followRequest.findMany({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
      include: { requester: { include: { profile: true } } },
    });
    return requests.flatMap((request) =>
      request.requester.profile
        ? [{ requester: toProfile(request.requester.profile), createdAt: request.createdAt }]
        : [],
    );
  }

  acceptRequest(targetId: string, requesterId: string): Promise<AcceptRequestResult> {
    return this.runSerializable(async (transaction) => {
      const request = await transaction.followRequest.findUnique({
        where: { requesterId_targetId: { requesterId, targetId } },
      });
      if (!request) return 'not_found';
      if (await this.hasBlock(transaction, requesterId, targetId)) return 'blocked';
      await transaction.follow.upsert({
        where: { followerId_followingId: { followerId: requesterId, followingId: targetId } },
        create: { followerId: requesterId, followingId: targetId },
        update: {},
      });
      await transaction.followRequest.delete({
        where: { requesterId_targetId: { requesterId, targetId } },
      });
      return 'following';
    });
  }

  async declineRequest(targetId: string, requesterId: string): Promise<boolean> {
    const result = await this.prisma.followRequest.deleteMany({
      where: { requesterId, targetId },
    });
    return result.count === 1;
  }

  block(actorId: string, targetId: string): Promise<BlockResult> {
    if (actorId === targetId) return Promise.resolve('self');
    return this.runSerializable(async (transaction) => {
      const target = await transaction.user.findFirst({
        where: { id: targetId, disabledAt: null },
        select: { id: true },
      });
      if (!target) return 'not_found';
      await transaction.block.upsert({
        where: { blockerId_blockedId: { blockerId: actorId, blockedId: targetId } },
        create: { blockerId: actorId, blockedId: targetId },
        update: {},
      });
      await transaction.follow.deleteMany({
        where: {
          OR: [
            { followerId: actorId, followingId: targetId },
            { followerId: targetId, followingId: actorId },
          ],
        },
      });
      await transaction.followRequest.deleteMany({
        where: {
          OR: [
            { requesterId: actorId, targetId },
            { requesterId: targetId, targetId: actorId },
          ],
        },
      });
      return 'blocked';
    });
  }

  async unblock(actorId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: actorId, blockedId: targetId } });
  }

  private async hasBlock(
    transaction: Prisma.TransactionClient,
    firstUserId: string,
    secondUserId: string,
  ): Promise<boolean> {
    return (
      (await transaction.block.count({
        where: {
          OR: [
            { blockerId: firstUserId, blockedId: secondUserId },
            { blockerId: secondUserId, blockedId: firstUserId },
          ],
        },
      })) > 0
    );
  }

  private async runSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') {
          throw error;
        }
      }
    }
    return this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
  }
}
