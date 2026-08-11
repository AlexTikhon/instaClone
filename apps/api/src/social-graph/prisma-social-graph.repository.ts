import { Injectable } from '@nestjs/common';

import type { Profile } from '@instaclone/api-contracts';
import { FOLLOW_REQUESTED_EVENT, USER_FOLLOWED_EVENT } from '@instaclone/api-contracts';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import type { SocialGraphRepository } from './social-graph.repository';
import type {
  AcceptRequestResult,
  BlockResult,
  FollowResult,
  IncomingFollowRequestPage,
  FollowRequestCursor,
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

  follow(actorId: string, targetId: string, correlationId: string): Promise<FollowResult> {
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
        const inserted = await transaction.followRequest.createMany({
          data: [{ requesterId: actorId, targetId }],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          const event = createOutboxEvent({
            eventName: FOLLOW_REQUESTED_EVENT,
            aggregateType: 'FollowRequest',
            aggregateId: targetId,
            correlationId,
            payload: { requesterId: actorId, targetUserId: targetId },
          });
          await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
        }
        return 'requested';
      }

      const inserted = await transaction.follow.createMany({
        data: [{ followerId: actorId, followingId: targetId }],
        skipDuplicates: true,
      });
      if (inserted.count === 1) {
        const event = createOutboxEvent({
          eventName: USER_FOLLOWED_EVENT,
          aggregateType: 'Follow',
          aggregateId: targetId,
          correlationId,
          payload: { actorId, targetUserId: targetId },
        });
        await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
      }
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

  async listIncomingRequests(
    targetId: string,
    limit: number,
    cursor: FollowRequestCursor | null,
  ): Promise<IncomingFollowRequestPage> {
    const requests = await this.prisma.followRequest.findMany({
      where: {
        targetId,
        requester: { disabledAt: null, profile: { isNot: null } },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, requesterId: { lt: cursor.requesterId } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { requesterId: 'desc' }],
      take: limit + 1,
      include: { requester: { include: { profile: true } } },
    });
    const hasNextPage = requests.length > limit;
    const page = requests.slice(0, limit);
    const mapped = page.flatMap((request) =>
      request.requester.profile
        ? [{ requester: toProfile(request.requester.profile), createdAt: request.createdAt }]
        : [],
    );
    const last = hasNextPage ? page.at(-1) : undefined;
    return {
      requests: mapped,
      nextCursor: last ? { createdAt: last.createdAt, requesterId: last.requesterId } : null,
    };
  }

  acceptRequest(targetId: string, requesterId: string): Promise<AcceptRequestResult> {
    return this.runSerializable(async (transaction) => {
      const users = await transaction.user.findMany({
        where: { id: { in: [targetId, requesterId] }, disabledAt: null, profile: { isNot: null } },
        select: { id: true },
      });
      if (users.length !== 2) return 'not_found';
      if (await this.hasBlock(transaction, requesterId, targetId)) return 'blocked';

      const request = await transaction.followRequest.findUnique({
        where: { requesterId_targetId: { requesterId, targetId } },
      });
      if (!request) {
        const existing = await transaction.follow.findUnique({
          where: { followerId_followingId: { followerId: requesterId, followingId: targetId } },
        });
        return existing ? 'following' : 'not_found';
      }
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

  async declineRequest(targetId: string, requesterId: string): Promise<void> {
    await this.prisma.followRequest.deleteMany({
      where: { requesterId, targetId },
    });
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

  async canViewPosts(viewerId: string, authorId: string): Promise<boolean> {
    const author = await this.prisma.user.findFirst({
      where: { id: authorId, disabledAt: null },
      select: { profile: { select: { isPrivate: true } } },
    });
    if (!author?.profile) return false;
    if (await this.hasBlock(this.prisma, viewerId, authorId)) return false;
    if (viewerId === authorId || !author.profile.isPrivate) return true;
    return (
      (await this.prisma.follow.count({
        where: { followerId: viewerId, followingId: authorId },
      })) > 0
    );
  }

  private async hasBlock(
    transaction: Prisma.TransactionClient | PrismaService,
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
