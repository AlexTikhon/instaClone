import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { DOMAIN_EVENTS_QUEUE, type EventEnvelope } from '@instaclone/api-contracts';
import type { ApiEnvironment } from '@instaclone/config';

@Injectable()
export class OutboxQueuePublisher implements OnModuleDestroy {
  private queue: Queue<EventEnvelope> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService<ApiEnvironment, true>) {}

  async publish(event: EventEnvelope): Promise<void> {
    const queue = this.getQueue();
    await queue.add(event.eventName, event, {
      jobId: event.eventId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    if (this.redis && this.redis.status !== 'end') await this.redis.quit();
  }

  private getQueue(): Queue<EventEnvelope> {
    if (!this.queue) {
      this.redis = new Redis(this.config.get('REDIS_URL', { infer: true }), {
        maxRetriesPerRequest: null,
      });
      this.queue = new Queue<EventEnvelope>(DOMAIN_EVENTS_QUEUE, { connection: this.redis });
    }
    return this.queue;
  }
}
