import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type {
  ExploreQuery,
  ExploreResponse,
  FeedEngagement,
  SearchUsersQuery,
  SearchUsersResponse,
} from '@instaclone/api-contracts';

import { EngagementHydrator } from '../engagement/engagement-hydrator';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import { postInclude, PostsService } from '../posts/posts.service';
import {
  decodeExploreCursor,
  decodeSearchCursor,
  encodeExploreCursor,
  encodeSearchCursor,
} from './search-cursor';
import { SEARCH_REPOSITORY, type SearchRepository } from './search.repository';

const EMPTY_ENGAGEMENT: FeedEngagement = {
  likeCount: 0,
  commentCount: 0,
  viewerHasLiked: false,
  viewerHasSaved: false,
};

@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly repository: SearchRepository,
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
    private readonly engagement: EngagementHydrator,
    private readonly posts: PostsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SearchService.name);
  }

  async users(viewerId: string, query: SearchUsersQuery): Promise<SearchUsersResponse> {
    const startedAt = performance.now();
    const rows = await this.repository.searchUsers(
      viewerId,
      query.q,
      query.limit + 1,
      query.cursor ? decodeSearchCursor(query.cursor, query.q) : null,
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = hasMore ? page.at(-1) : undefined;
    this.logger.info(
      {
        viewerId,
        queryLength: query.q.length,
        resultCount: page.length,
        latencyMs: Math.round(performance.now() - startedAt),
      },
      'user search served',
    );
    return {
      users: page.map((row) => ({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        isPrivate: row.isPrivate,
        relationship: row.relationship,
      })),
      nextCursor: last
        ? encodeSearchCursor({
            query: query.q,
            rank: last.rank,
            normalizedUsername: last.normalizedUsername,
            userId: last.userId,
          })
        : null,
      hasMore,
    };
  }

  async explore(viewerId: string, query: ExploreQuery): Promise<ExploreResponse> {
    const startedAt = performance.now();
    const candidates = await this.repository.findExploreCandidates(
      viewerId,
      query.limit + 1,
      query.cursor ? decodeExploreCursor(query.cursor) : null,
    );
    const hasMore = candidates.length > query.limit;
    const page = candidates.slice(0, query.limit);
    const snapshotAt = page[0]?.snapshotAt ?? new Date();
    const postIds = page.map((candidate) => candidate.postId);
    const [postRows, engagement] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          id: { in: postIds },
          ...this.access.visibleWhere(viewerId),
          media: {
            some: {},
            every: { mediaAsset: { status: 'READY', thumbnailObjectKey: { not: null } } },
          },
        },
        include: postInclude,
      }),
      this.engagement.hydrate(viewerId, postIds),
    ]);
    const byId = new Map(postRows.map((post) => [post.id, post]));
    const items = await Promise.all(
      page.flatMap((candidate) => {
        const post = byId.get(candidate.postId);
        return post
          ? [
              this.posts.toResponse(post).then((response) => ({
                post: response,
                engagement: engagement.get(post.id) ?? EMPTY_ENGAGEMENT,
              })),
            ]
          : [];
      }),
    );
    const last = hasMore ? page.at(-1) : undefined;
    this.logger.info(
      {
        viewerId,
        candidateCount: candidates.length,
        itemCount: items.length,
        snapshotAt: snapshotAt.toISOString(),
        latencyMs: Math.round(performance.now() - startedAt),
      },
      'explore page served',
    );
    return {
      items,
      nextCursor: last
        ? encodeExploreCursor({
            snapshotAt: last.snapshotAt,
            score: last.score,
            createdAt: last.createdAt,
            postId: last.postId,
          })
        : null,
      hasMore,
      snapshotAt: snapshotAt.toISOString(),
    };
  }
}
