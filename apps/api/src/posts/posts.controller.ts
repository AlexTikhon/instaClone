import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  createPostInputSchema,
  listPostsQuerySchema,
  postIdSchema,
  type PaginatedPostsResponse,
  type PostResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<PostResponse> {
    return this.posts.create(
      request.identity.id,
      parseRequest(createPostInputSchema, body),
      request.id,
    );
  }

  @Get()
  @UseGuards(AccessAuthGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<PaginatedPostsResponse> {
    return this.posts.list(request.identity.id, parseRequest(listPostsQuerySchema, query));
  }

  @Get(':postId')
  @UseGuards(AccessAuthGuard)
  get(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ): Promise<PostResponse> {
    return this.posts.get(request.identity.id, parseRequest(postIdSchema, postId));
  }

  @Delete(':postId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  delete(@Req() request: AuthenticatedRequest, @Param('postId') postId: string): Promise<void> {
    return this.posts.delete(request.identity.id, parseRequest(postIdSchema, postId));
  }
}
