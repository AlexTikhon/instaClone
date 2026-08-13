import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import type {
  CreateReelInput,
  ReelResponse,
  ReelsQuery,
  ReelsResponse,
} from '@instaclone/api-contracts';

import { Prisma, type Profile } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { MediaService, type PlayableVideoAsset } from '../media/media.service';
import { ApiError } from '../platform/errors/api-error';
import { ReelAccessPolicy } from './reel-access-policy';
import { decodeReelCursor, encodeReelCursor } from './reel-cursor';

interface ReelView {
  id: string;
  caption: string;
  createdAt: Date;
  updatedAt: Date;
  author: { profile: Profile | null };
  mediaAsset: PlayableVideoAsset;
}

const reelInclude = {
  author: { select: { profile: true } },
  mediaAsset: { include: { variants: true } },
} as const;

@Injectable()
export class ReelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly access: ReelAccessPolicy,
  ) {}

  async create(authorId: string, input: CreateReelInput): Promise<ReelResponse> {
    await this.media.requireOwnedReadyForReel(authorId, input.mediaAssetId);
    try {
      const reel = await this.prisma.reel.create({
        data: {
          id: randomUUID(),
          authorId,
          mediaAssetId: input.mediaAssetId,
          caption: input.caption,
        },
        include: reelInclude,
      });
      return this.toResponse(reel);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'REEL_MEDIA_ALREADY_PUBLISHED',
          'Video media is already published as a Reel',
        );
      }
      throw error;
    }
  }

  async get(viewerId: string, reelId: string): Promise<ReelResponse> {
    const reel = await this.prisma.reel.findFirst({
      where: { id: reelId, ...this.access.visibleWhere(viewerId) },
      include: reelInclude,
    });
    if (!reel) throw new ApiError(HttpStatus.NOT_FOUND, 'REEL_NOT_FOUND', 'Reel was not found');
    return this.toResponse(reel);
  }

  async list(viewerId: string, query: ReelsQuery): Promise<ReelsResponse> {
    const cursor = query.cursor ? decodeReelCursor(query.cursor) : null;
    const rows = await this.prisma.reel.findMany({
      where: {
        AND: [
          this.access.visibleWhere(viewerId),
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: reelInclude,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      reels: page.map((reel) => this.toResponse(reel)),
      nextCursor: last ? encodeReelCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    };
  }

  async delete(authorId: string, reelId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        { authorId: string; deletedAt: Date | null; moderationRemovedAt: Date | null }[]
      >(Prisma.sql`
        SELECT "authorId", "deletedAt", "moderationRemovedAt"
        FROM reels WHERE id = ${reelId}::uuid FOR UPDATE
      `);
      const reel = rows[0];
      if (!reel || reel.deletedAt || reel.moderationRemovedAt) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'REEL_NOT_FOUND', 'Reel was not found');
      }
      if (reel.authorId !== authorId) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'REEL_NOT_OWNED',
          'Only the Reel author may delete it',
        );
      }
      await transaction.reel.update({ where: { id: reelId }, data: { deletedAt: new Date() } });
    });
  }

  async requirePlayback(viewerId: string, reelId: string): Promise<string> {
    const reel = await this.access.requireVisible(this.prisma, viewerId, reelId);
    return reel.mediaAssetId;
  }

  private toResponse(reel: ReelView): ReelResponse {
    if (!reel.author.profile) throw new Error('Reel author profile is missing');
    return {
      id: reel.id,
      author: reel.author.profile,
      caption: reel.caption,
      createdAt: reel.createdAt.toISOString(),
      updatedAt: reel.updatedAt.toISOString(),
      playback: this.media.toVideoPlayback(reel.mediaAsset, reel.id),
    };
  }
}
