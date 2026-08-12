import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SocialGraphModule } from '../social-graph/social-graph.module';
import { MessagingController } from './messaging.controller';
import { MESSAGING_REPOSITORY } from './messaging.repository';
import { MessagingService } from './messaging.service';
import { PrismaMessagingRepository } from './prisma-messaging.repository';

@Module({
  imports: [AuthModule, SocialGraphModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    { provide: MESSAGING_REPOSITORY, useClass: PrismaMessagingRepository },
  ],
})
export class MessagingModule {}
