import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PostAccessModule } from '../post-access/post-access.module';
import { IdentityModule } from '../identity/identity.module';
import { CommentsService } from './comments.service';
import { EngagementController } from './engagement.controller';
import { EngagementHydrator } from './engagement-hydrator';
import { LikesService } from './likes.service';
import { SavedPostsService } from './saved-posts.service';
import { CommentModerationPolicy } from './comment-moderation-policy';

@Module({
  imports: [AuthModule, IdentityModule, PostAccessModule],
  controllers: [EngagementController],
  providers: [
    CommentsService,
    EngagementHydrator,
    LikesService,
    SavedPostsService,
    CommentModerationPolicy,
  ],
  exports: [EngagementHydrator, CommentModerationPolicy],
})
export class EngagementModule {}
