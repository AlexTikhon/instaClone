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
  commentsQuerySchema,
  createCommentInputSchema,
  postIdSchema,
  type CommentResponse,
  type CommentsResponse,
  type LikeResponse,
  type SaveResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { CommentsService } from './comments.service';
import { LikesService } from './likes.service';
import { SavedPostsService } from './saved-posts.service';

@Controller()
export class EngagementController {
  constructor(
    private readonly likes: LikesService,
    private readonly comments: CommentsService,
    private readonly savedPosts: SavedPostsService,
  ) {}

  @Put('posts/:postId/like')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  like(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ): Promise<LikeResponse> {
    return this.likes.like(request.identity.id, parseRequest(postIdSchema, postId), request.id);
  }

  @Delete('posts/:postId/like')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  unlike(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ): Promise<LikeResponse> {
    return this.likes.unlike(request.identity.id, parseRequest(postIdSchema, postId));
  }

  @Put('posts/:postId/save')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  save(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ): Promise<SaveResponse> {
    return this.savedPosts.save(request.identity.id, parseRequest(postIdSchema, postId));
  }

  @Delete('posts/:postId/save')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  unsave(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
  ): Promise<SaveResponse> {
    return this.savedPosts.unsave(request.identity.id, parseRequest(postIdSchema, postId));
  }

  @Post('posts/:postId/comments')
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  createComment(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<CommentResponse> {
    return this.comments.create(
      request.identity.id,
      parseRequest(postIdSchema, postId),
      parseRequest(createCommentInputSchema, body),
      request.id,
    );
  }

  @Get('posts/:postId/comments')
  @UseGuards(AccessAuthGuard)
  listComments(
    @Req() request: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Query() query: unknown,
  ): Promise<CommentsResponse> {
    return this.comments.list(
      request.identity.id,
      parseRequest(postIdSchema, postId),
      parseRequest(commentsQuerySchema, query),
    );
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  deleteComment(
    @Req() request: AuthenticatedRequest,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    return this.comments.delete(request.identity.id, parseRequest(postIdSchema, commentId));
  }
}
