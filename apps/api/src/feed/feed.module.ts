import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EngagementModule } from '../engagement/engagement.module';
import { PostAccessModule } from '../post-access/post-access.module';
import { PostsModule } from '../posts/posts.module';
import { IdentityModule } from '../identity/identity.module';
import { CandidateSource } from './candidate-source';
import { ChronologicalFeedRanker } from './chronological-feed-ranker';
import { FeedController } from './feed.controller';
import { FEED_RANKER } from './feed-ranker';
import { FeedService } from './feed.service';

@Module({
  imports: [AuthModule, EngagementModule, IdentityModule, PostAccessModule, PostsModule],
  controllers: [FeedController],
  providers: [
    CandidateSource,
    ChronologicalFeedRanker,
    FeedService,
    { provide: FEED_RANKER, useExisting: ChronologicalFeedRanker },
  ],
})
export class FeedModule {}
