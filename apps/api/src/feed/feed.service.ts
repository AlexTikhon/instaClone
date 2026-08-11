import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { FeedQuery, FeedResponse } from '@instaclone/api-contracts';

import { EngagementHydrator } from '../engagement/engagement-hydrator';
import { PostsService, type PostView } from '../posts/posts.service';
import { CandidateSource } from './candidate-source';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { FEED_RANKER, type FeedRanker } from './feed-ranker';

@Injectable()
export class FeedService {
  constructor(
    private readonly candidates: CandidateSource,
    @Inject(FEED_RANKER) private readonly ranker: FeedRanker<PostView>,
    private readonly engagement: EngagementHydrator,
    private readonly posts: PostsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FeedService.name);
  }

  async get(viewerId: string, query: FeedQuery): Promise<FeedResponse> {
    const startedAt = performance.now();
    const candidates = await this.candidates.find(
      viewerId,
      query.limit,
      query.cursor ? decodeFeedCursor(query.cursor) : null,
    );
    const hasMore = candidates.length > query.limit;
    const page = this.ranker.rank(viewerId, candidates.slice(0, query.limit));
    const hydrated = await this.engagement.hydrate(
      viewerId,
      page.map((post) => post.id),
    );
    const items = await Promise.all(
      page.map(async (post) => ({
        post: await this.posts.toResponse(post),
        engagement: hydrated.get(post.id) ?? {
          likeCount: 0,
          commentCount: 0,
          viewerHasLiked: false,
          viewerHasSaved: false,
        },
      })),
    );
    const last = hasMore ? page.at(-1) : undefined;
    this.logger.info(
      {
        viewerId,
        candidateCount: candidates.length,
        itemCount: items.length,
        latencyMs: Math.round(performance.now() - startedAt),
      },
      'feed page served',
    );
    return {
      items,
      nextCursor: last ? encodeFeedCursor({ createdAt: last.createdAt, postId: last.id }) : null,
      hasMore,
    };
  }
}
