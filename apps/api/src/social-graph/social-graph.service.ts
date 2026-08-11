import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { z } from 'zod';

import type {
  FollowRequestsQuery,
  FollowRequestsResponse,
  SocialConnectionResponse,
} from '@instaclone/api-contracts';

import { SOCIAL_GRAPH_REPOSITORY, type SocialGraphRepository } from './social-graph.repository';

@Injectable()
export class SocialGraphService {
  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY) private readonly socialGraph: SocialGraphRepository,
  ) {}

  async follow(actorId: string, targetId: string): Promise<SocialConnectionResponse> {
    const result = await this.socialGraph.follow(actorId, targetId);
    if (result === 'self') throw new BadRequestException('You cannot follow yourself');
    if (result === 'not_found' || result === 'blocked') {
      throw new NotFoundException('User is not available');
    }
    return { state: result };
  }

  unfollow(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) throw new BadRequestException('You cannot unfollow yourself');
    return this.socialGraph.unfollow(actorId, targetId);
  }

  async incomingRequests(
    targetId: string,
    query: FollowRequestsQuery,
  ): Promise<FollowRequestsResponse> {
    const page = await this.socialGraph.listIncomingRequests(
      targetId,
      query.limit,
      query.cursor ? decodeCursor(query.cursor) : null,
    );
    return {
      requests: page.requests.map((request) => ({
        requester: request.requester,
        requestedAt: request.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    };
  }

  async acceptRequest(targetId: string, requesterId: string): Promise<SocialConnectionResponse> {
    const result = await this.socialGraph.acceptRequest(targetId, requesterId);
    if (result !== 'following') throw new NotFoundException('Follow request not found');
    return { state: 'following' };
  }

  async declineRequest(targetId: string, requesterId: string): Promise<void> {
    await this.socialGraph.declineRequest(targetId, requesterId);
  }

  async block(actorId: string, targetId: string): Promise<void> {
    const result = await this.socialGraph.block(actorId, targetId);
    if (result === 'self') throw new BadRequestException('You cannot block yourself');
    if (result === 'not_found') throw new NotFoundException('User is not available');
  }

  unblock(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) throw new BadRequestException('You cannot unblock yourself');
    return this.socialGraph.unblock(actorId, targetId);
  }

  canViewPosts(viewerId: string, authorId: string): Promise<boolean> {
    return this.socialGraph.canViewPosts(viewerId, authorId);
  }
}

const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  requesterId: z.uuid(),
});

const encodeCursor = (cursor: { createdAt: Date; requesterId: string }): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), requesterId: cursor.requesterId }),
  ).toString('base64url');

const decodeCursor = (cursor: string): { createdAt: Date; requesterId: string } => {
  try {
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    return { createdAt: new Date(decoded.createdAt), requesterId: decoded.requesterId };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
};
