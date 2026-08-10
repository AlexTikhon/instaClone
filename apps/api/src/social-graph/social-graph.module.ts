import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaSocialGraphRepository } from './prisma-social-graph.repository';
import { SocialGraphController } from './social-graph.controller';
import { SOCIAL_GRAPH_REPOSITORY } from './social-graph.repository';
import { SocialGraphService } from './social-graph.service';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [SocialGraphController],
  providers: [
    SocialGraphService,
    { provide: SOCIAL_GRAPH_REPOSITORY, useClass: PrismaSocialGraphRepository },
  ],
  exports: [SocialGraphService],
})
export class SocialGraphModule {}
