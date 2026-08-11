import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  createStoryInputSchema,
  storyAuthorIdSchema,
  storyIdSchema,
  storyViewersQuerySchema,
  type StoryResponse,
  type StorySequenceResponse,
  type StoryTrayResponse,
  type StoryViewersResponse,
  type StoryViewResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { StoriesService } from './stories.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Post()
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<StoryResponse> {
    return this.stories.create(
      request.identity.id,
      parseRequest(createStoryInputSchema, body),
      request.id,
    );
  }

  @Get()
  @UseGuards(AccessAuthGuard)
  tray(@Req() request: AuthenticatedRequest): Promise<StoryTrayResponse> {
    return this.stories.tray(request.identity.id);
  }

  @Get('users/:authorId')
  @UseGuards(AccessAuthGuard)
  sequence(
    @Req() request: AuthenticatedRequest,
    @Param('authorId') authorId: string,
  ): Promise<StorySequenceResponse> {
    return this.stories.sequence(request.identity.id, parseRequest(storyAuthorIdSchema, authorId));
  }

  @Get(':storyId/viewers')
  @UseGuards(AccessAuthGuard)
  viewers(
    @Req() request: AuthenticatedRequest,
    @Param('storyId') storyId: string,
    @Query() query: unknown,
  ): Promise<StoryViewersResponse> {
    return this.stories.viewers(
      request.identity.id,
      parseRequest(storyIdSchema, storyId),
      parseRequest(storyViewersQuerySchema, query),
    );
  }

  @Put(':storyId/view')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  view(
    @Req() request: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ): Promise<StoryViewResponse> {
    return this.stories.recordView(request.identity.id, parseRequest(storyIdSchema, storyId));
  }

  @Get(':storyId')
  @UseGuards(AccessAuthGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('storyId') storyId: string,
  ): Promise<StoryResponse> {
    return this.stories.get(request.identity.id, parseRequest(storyIdSchema, storyId));
  }

  @Delete(':storyId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  delete(@Req() request: AuthenticatedRequest, @Param('storyId') storyId: string): Promise<void> {
    return this.stories.delete(request.identity.id, parseRequest(storyIdSchema, storyId));
  }
}
