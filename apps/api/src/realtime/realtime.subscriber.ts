import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  APPLICATION_REALTIME_CHANNEL,
  applicationRealtimeEnvelopeSchema,
} from '@instaclone/api-contracts';
import type { ApiEnvironment } from '@instaclone/config';

import { RealtimeHub } from './realtime.hub';

@Injectable()
export class RealtimeSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: Redis;

  constructor(
    config: ConfigService<ApiEnvironment, true>,
    private readonly hub: RealtimeHub,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeSubscriber.name);
    this.subscriber = new Redis(config.get('REDIS_URL', { infer: true }), {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  onModuleInit(): void {
    this.subscriber.on('message', (channel, message) => {
      if (channel !== APPLICATION_REALTIME_CHANNEL) return;
      try {
        const envelope = applicationRealtimeEnvelopeSchema.parse(JSON.parse(message));
        this.hub.deliver(envelope.recipientId, envelope.message);
      } catch (error) {
        this.logger.warn({ error }, 'invalid realtime envelope ignored');
      }
    });
    this.subscriber.on('ready', () => {
      void this.subscriber
        .subscribe(APPLICATION_REALTIME_CHANNEL)
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
