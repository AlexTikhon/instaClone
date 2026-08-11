import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { feedQuerySchema, type FeedResponse } from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { parseRequest } from '../auth/request-validation';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  @UseGuards(AccessAuthGuard)
  get(@Req() request: AuthenticatedRequest, @Query() query: unknown): Promise<FeedResponse> {
    return this.feed.get(request.identity.id, parseRequest(feedQuerySchema, query));
  }
}
