import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  COMMENT_CREATED_EVENT,
  type CommentResponse,
  type CommentsQuery,
  type CommentsResponse,
  type CreateCommentInput,
  type Profile,
} from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import { decodeCommentCursor, encodeCommentCursor } from './comment-cursor';

interface CommentView {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: { profile: Profile | null };
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
  ) {}

  create(
    authorId: string,
    postId: string,
    input: CreateCommentInput,
    correlationId: string,
  ): Promise<CommentResponse> {
    return this.prisma.$transaction(async (transaction) => {
      const post = await this.access.requireInteractablePost(transaction, authorId, postId);
      const commentId = randomUUID();
      const comment = await transaction.comment.create({
        data: { id: commentId, postId, authorId, body: input.body },
        include: { author: { select: { profile: true } } },
      });
      const event = createOutboxEvent({
        eventName: COMMENT_CREATED_EVENT,
        aggregateType: 'Comment',
        aggregateId: commentId,
        correlationId,
        payload: { commentId, postId, postAuthorId: post.authorId, authorId },
      });
      await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
      return this.toResponse(comment, authorId);
    });
  }

  async list(viewerId: string, postId: string, query: CommentsQuery): Promise<CommentsResponse> {
    await this.access.requireVisiblePost(this.prisma, viewerId, postId);
    const cursor = query.cursor ? decodeCommentCursor(query.cursor) : null;
    const rows = await this.prisma.comment.findMany({
      where: {
        postId,
        deletedAt: null,
        moderationRemovedAt: null,
        author: { disabledAt: null, profile: { isNot: null } },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { author: { select: { profile: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      comments: page.map((comment) => this.toResponse(comment, viewerId)),
      nextCursor: last ? encodeCommentCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    };
  }

  async delete(viewerId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null, moderationRemovedAt: null },
      select: { authorId: true },
    });
    if (!comment) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'COMMENT_NOT_FOUND', 'Comment was not found');
    }
    if (comment.authorId !== viewerId) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'COMMENT_NOT_OWNED',
        'Only the comment author may delete it',
      );
    }
    await this.prisma.comment.updateMany({
      where: {
        id: commentId,
        authorId: viewerId,
        deletedAt: null,
        moderationRemovedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }

  private toResponse(comment: CommentView, viewerId: string): CommentResponse {
    if (!comment.author.profile) throw new Error('Comment author profile is missing');
    return {
      id: comment.id,
      postId: comment.postId,
      author: comment.author.profile,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      viewerCanDelete: comment.authorId === viewerId,
    };
  }
}
