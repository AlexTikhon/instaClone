import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  NOTIFICATION_REALTIME_CHANNEL,
  notificationRealtimeEnvelopeSchema,
} from '@instaclone/api-contracts';
import type { ApiEnvironment } from '@instaclone/config';

import { NotificationRealtimeHub } from './notification-realtime.hub';

@Injectable()
export class NotificationRealtimeSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: Redis;

  constructor(
    config: ConfigService<ApiEnvironment, true>,
    private readonly hub: NotificationRealtimeHub,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationRealtimeSubscriber.name);
    this.subscriber = new Redis(config.get('REDIS_URL', { infer: true }), {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  onModuleInit(): void {
    this.subscriber.on('message', (channel, message) => {
      if (channel !== NOTIFICATION_REALTIME_CHANNEL) return;
      try {
        const envelope = notificationRealtimeEnvelopeSchema.parse(JSON.parse(message));
        this.hub.deliver(envelope.recipientId, envelope.payload);
      } catch (error) {
        this.logger.warn({ error }, 'invalid notification realtime envelope ignored');
      }
    });
    this.subscriber.on('ready', () => {
      void this.subscriber
        .subscribe(NOTIFICATION_REALTIME_CHANNEL)
        .catch((error: unknown) => this.logger.warn({ error }, 'realtime subscription failed'));
    });
    this.subscriber.on('error', (error) =>
      this.logger.warn({ error }, 'realtime Redis subscriber error'),
    );
    void this.subscriber
      .connect()
      .catch((error: unknown) => this.logger.warn({ error }, 'realtime Redis connection failed'));
  }

  onModuleDestroy(): void {
    if (this.subscriber.status !== 'end') this.subscriber.disconnect();
  }
}
