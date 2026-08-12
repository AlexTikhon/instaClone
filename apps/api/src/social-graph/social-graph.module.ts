import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaSocialGraphRepository } from './prisma-social-graph.repository';
import { SocialGraphController } from './social-graph.controller';
import { SOCIAL_GRAPH_REPOSITORY } from './social-graph.repository';
import { SocialGraphService } from './social-graph.service';
import { SocialInteractionPolicy } from './social-interaction.policy';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [SocialGraphController],
  providers: [
    SocialGraphService,
    SocialInteractionPolicy,
    { provide: SOCIAL_GRAPH_REPOSITORY, useClass: PrismaSocialGraphRepository },
  ],
  exports: [SocialGraphService, SocialInteractionPolicy],
})
export class SocialGraphModule {}
