import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  POST_CREATED_EVENT,
  type CreatePostInput,
  type ListPostsQuery,
  type PaginatedPostsResponse,
  type PostResponse,
  type Profile,
} from '@instaclone/api-contracts';

import { Prisma, type MediaAsset } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import { decodePostCursor, encodePostCursor } from './post-cursor';

export interface PostView {
  id: string;
  caption: string;
  createdAt: Date;
  updatedAt: Date;
  author: { profile: Profile | null };
  media: { position: number; mediaAsset: MediaAsset }[];
}

export const postInclude = {
  author: { select: { profile: true } },
  media: { orderBy: { position: 'asc' as const }, include: { mediaAsset: true } },
} as const;

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly access: PostAccessPolicy,
  ) {}

  async create(
    authorId: string,
    input: CreatePostInput,
    correlationId: string,
  ): Promise<PostResponse> {
    const assets = await this.media.requireOwnedReadyForPost(authorId, input.mediaAssetIds);
    const postId = randomUUID();
    const event = createOutboxEvent({
      eventName: POST_CREATED_EVENT,
      aggregateType: 'Post',
      aggregateId: postId,
      correlationId,
      payload: { postId, authorId, mediaAssetIds: input.mediaAssetIds },
    });
    try {
      const post = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.post.create({
          data: {
            id: postId,
            authorId,
            caption: input.caption,
            media: {
              create: assets.map((asset, position) => ({ mediaAssetId: asset.id, position })),
            },
          },
          include: postInclude,
        });
        await transaction.outboxEvent.create({
          data: { ...event, payload: event.payload },
        });
        return created;
      });
      return this.toResponse(post);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ApiError(HttpStatus.CONFLICT, 'INVALID_POST_MEDIA', 'Media is already attached');
      }
      throw error;
    }
  }

  async get(viewerId: string, postId: string): Promise<PostResponse> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, ...this.access.visibleWhere(viewerId) },
      include: postInclude,
    });
    if (!post) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Post was not found');
    }
    return this.toResponse(post);
  }

  async list(viewerId: string, query: ListPostsQuery): Promise<PaginatedPostsResponse> {
    const cursor = query.cursor ? decodePostCursor(query.cursor) : null;
    const rows = await this.prisma.post.findMany({
      where: {
        authorId: query.authorId,
        ...this.access.visibleWhere(viewerId),
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
      include: postInclude,
    });
    const hasNextPage = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasNextPage ? page.at(-1) : undefined;
    return {
      posts: await Promise.all(page.map((post) => this.toResponse(post))),
      nextCursor: last ? encodePostCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async delete(authorId: string, postId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<{ authorId: string; deletedAt: Date | null }[]>(
        Prisma.sql`SELECT "authorId", "deletedAt" FROM posts WHERE id = ${postId}::uuid FOR UPDATE`,
      );
      const post = rows[0];
      if (!post || post.deletedAt) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'POST_NOT_FOUND', 'Post was not found');
      }
      if (post.authorId !== authorId) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'POST_NOT_OWNED',
          'Only the post author may delete it',
        );
      }
      await transaction.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
    });
  }

  async toResponse(post: PostView): Promise<PostResponse> {
    if (!post.author.profile) throw new Error('Post author profile is missing');
    return {
      id: post.id,
      author: post.author.profile,
      caption: post.caption,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      media: await Promise.all(
        post.media.map(async (item) => ({
          ...(await this.media.toResponse(item.mediaAsset)),
          position: item.position,
        })),
      ),
    };
  }
}

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
