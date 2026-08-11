import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import {
  exploreQuerySchema,
  searchUsersQuerySchema,
  type ExploreResponse,
  type SearchUsersResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AuthRateLimitGuard, RequestRateLimit } from '../auth/auth-rate-limit.guard';
import { parseRequest } from '../auth/request-validation';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('users')
  @RequestRateLimit({ bucket: 'search-users', limit: 120, windowSeconds: 60 })
  @UseGuards(AccessAuthGuard, AuthRateLimitGuard)
  users(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<SearchUsersResponse> {
    return this.search.users(request.identity.id, parseRequest(searchUsersQuerySchema, query));
  }
}

@Controller('explore')
export class ExploreController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequestRateLimit({ bucket: 'explore', limit: 120, windowSeconds: 60 })
  @UseGuards(AccessAuthGuard, AuthRateLimitGuard)
  explore(@Req() request: AuthenticatedRequest, @Query() query: unknown): Promise<ExploreResponse> {
    return this.search.explore(request.identity.id, parseRequest(exploreQuerySchema, query));
  }
}
