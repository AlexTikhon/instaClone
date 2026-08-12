import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { MediaModule } from '../media/media.module';
import { StoryAccessPolicy } from './story-access-policy';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

@Module({
  imports: [AuthModule, IdentityModule, MediaModule],
  controllers: [StoriesController],
  providers: [StoriesService, StoryAccessPolicy],
  exports: [StoriesService, StoryAccessPolicy],
})
export class StoriesModule {}
