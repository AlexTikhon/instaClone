import { Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';

import {
  socialUserIdSchema,
  type FollowRequestsResponse,
  type SocialConnectionResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { SocialGraphService } from './social-graph.service';

@Controller('social')
export class SocialGraphController {
  constructor(private readonly socialGraph: SocialGraphService) {}

  @Post('follows/:targetId')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  follow(
    @Req() request: AuthenticatedRequest,
    @Param('targetId') targetId: string,
  ): Promise<SocialConnectionResponse> {
    return this.socialGraph.follow(request.identity.id, this.userId(targetId));
  }

  @Delete('follows/:targetId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  unfollow(
    @Req() request: AuthenticatedRequest,
    @Param('targetId') targetId: string,
  ): Promise<void> {
    return this.socialGraph.unfollow(request.identity.id, this.userId(targetId));
  }

  @Get('follow-requests')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard)
  incomingRequests(@Req() request: AuthenticatedRequest): Promise<FollowRequestsResponse> {
    return this.socialGraph.incomingRequests(request.identity.id);
  }

  @Post('follow-requests/:requesterId/accept')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  acceptRequest(
    @Req() request: AuthenticatedRequest,
    @Param('requesterId') requesterId: string,
  ): Promise<SocialConnectionResponse> {
    return this.socialGraph.acceptRequest(request.identity.id, this.userId(requesterId));
  }

  @Delete('follow-requests/:requesterId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  declineRequest(
    @Req() request: AuthenticatedRequest,
    @Param('requesterId') requesterId: string,
  ): Promise<void> {
    return this.socialGraph.declineRequest(request.identity.id, this.userId(requesterId));
  }

  @Post('blocks/:targetId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  block(@Req() request: AuthenticatedRequest, @Param('targetId') targetId: string): Promise<void> {
    return this.socialGraph.block(request.identity.id, this.userId(targetId));
  }

  @Delete('blocks/:targetId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  unblock(
    @Req() request: AuthenticatedRequest,
    @Param('targetId') targetId: string,
  ): Promise<void> {
    return this.socialGraph.unblock(request.identity.id, this.userId(targetId));
  }

  private userId(value: string): string {
    return parseRequest(socialUserIdSchema, value);
  }
}
