import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { MediaModule } from '../media/media.module';
import { ReelAccessPolicy } from './reel-access-policy';
import { ReelsController } from './reels.controller';
import { ReelsService } from './reels.service';

@Module({
  imports: [AuthModule, IdentityModule, MediaModule],
  controllers: [ReelsController],
  providers: [ReelsService, ReelAccessPolicy],
  exports: [ReelsService, ReelAccessPolicy],
})
export class ReelsModule {}
