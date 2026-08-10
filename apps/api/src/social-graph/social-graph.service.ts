import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { FollowRequestsResponse, SocialConnectionResponse } from '@instaclone/api-contracts';

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

  async incomingRequests(targetId: string): Promise<FollowRequestsResponse> {
    const requests = await this.socialGraph.listIncomingRequests(targetId);
    return {
      requests: requests.map((request) => ({
        requester: request.requester,
        requestedAt: request.createdAt.toISOString(),
      })),
    };
  }

  async acceptRequest(targetId: string, requesterId: string): Promise<SocialConnectionResponse> {
    const result = await this.socialGraph.acceptRequest(targetId, requesterId);
    if (result !== 'following') throw new NotFoundException('Follow request not found');
    return { state: 'following' };
  }

  async declineRequest(targetId: string, requesterId: string): Promise<void> {
    if (!(await this.socialGraph.declineRequest(targetId, requesterId))) {
      throw new NotFoundException('Follow request not found');
    }
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
}
