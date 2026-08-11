import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';
import { NotificationRealtimeHub } from './notification-realtime.hub';
import { NotificationRealtimeSubscriber } from './notification-realtime.subscriber';

@Module({
  imports: [AuthModule],
  providers: [NotificationRealtimeGateway, NotificationRealtimeHub, NotificationRealtimeSubscriber],
  exports: [NotificationRealtimeHub],
})
export class RealtimeModule {}
