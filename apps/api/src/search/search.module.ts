import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EngagementModule } from '../engagement/engagement.module';
import { PostAccessModule } from '../post-access/post-access.module';
import { PostsModule } from '../posts/posts.module';
import { PrismaSearchRepository } from './prisma-search.repository';
import { ExploreController, SearchController } from './search.controller';
import { SEARCH_REPOSITORY } from './search.repository';
import { SearchService } from './search.service';

@Module({
  imports: [AuthModule, EngagementModule, PostAccessModule, PostsModule],
  controllers: [SearchController, ExploreController],
  providers: [
    SearchService,
    PrismaSearchRepository,
    { provide: SEARCH_REPOSITORY, useExisting: PrismaSearchRepository },
  ],
})
export class SearchModule {}
