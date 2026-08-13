import { Module } from '@nestjs/common';

import { AccountAccessModule } from '../account-access/account-access.module';
import { AuthModule } from '../auth/auth.module';
import { PostAccessModule } from '../post-access/post-access.module';
import { StoriesModule } from '../stories/stories.module';
import { EngagementModule } from '../engagement/engagement.module';
import { ReelsModule } from '../reels/reels.module';
import { MODERATION_REPOSITORY } from './moderation.repository';
import { ModerationAdminController } from './moderation-admin.controller';
import { ModerationPolicy } from './moderation-policy';
import { ModerationService } from './moderation.service';
import { ModeratorGuard } from './moderator.guard';
import { PrismaModerationRepository } from './prisma-moderation.repository';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    AuthModule,
    AccountAccessModule,
    PostAccessModule,
    StoriesModule,
    EngagementModule,
    ReelsModule,
  ],
  controllers: [ReportsController, ModerationAdminController],
  providers: [
    ModerationService,
    ModerationPolicy,
    ModeratorGuard,
    { provide: MODERATION_REPOSITORY, useClass: PrismaModerationRepository },
  ],
})
export class ModerationModule {}
