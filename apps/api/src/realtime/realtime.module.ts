import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeHub } from './realtime.hub';
import { RealtimeSubscriber } from './realtime.subscriber';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeHub, RealtimeSubscriber],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
