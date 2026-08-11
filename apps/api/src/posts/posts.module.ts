import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { IdentityModule } from '../identity/identity.module';
import { SocialGraphModule } from '../social-graph/social-graph.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [AuthModule, IdentityModule, MediaModule, SocialGraphModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
