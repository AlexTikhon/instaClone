import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import {
  DOMAIN_EVENTS_QUEUE,
  VIDEO_PROCESSING_QUEUE,
  VIDEO_UPLOADED_EVENT,
  videoUploadedEventSchema,
  type EventEnvelope,
} from '@instaclone/api-contracts';
import type { ApiEnvironment } from '@instaclone/config';

@Injectable()
export class OutboxQueuePublisher implements OnModuleDestroy {
  private queue: Queue<EventEnvelope> | null = null;
  private videoQueue: Queue<EventEnvelope> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService<ApiEnvironment, true>) {}

  async publish(event: EventEnvelope): Promise<void> {
    if (event.eventName === VIDEO_UPLOADED_EVENT) {
      const videoEvent = videoUploadedEventSchema.parse(event);
      await this.getVideoQueue().add(event.eventName, event, {
        jobId: `video-process-${videoEvent.payload.mediaId}-v1`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
      });
      return;
    }
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
    await this.videoQueue?.close();
    if (this.redis && this.redis.status !== 'end') await this.redis.quit();
  }

  private getQueue(): Queue<EventEnvelope> {
    if (!this.queue) {
      this.redis ??= new Redis(this.config.get('REDIS_URL', { infer: true }), {
        maxRetriesPerRequest: null,
      });
      this.queue = new Queue<EventEnvelope>(DOMAIN_EVENTS_QUEUE, { connection: this.redis });
    }
    return this.queue;
  }

  private getVideoQueue(): Queue<EventEnvelope> {
    if (!this.videoQueue) {
      this.redis ??= new Redis(this.config.get('REDIS_URL', { infer: true }), {
        maxRetriesPerRequest: null,
      });
      this.videoQueue = new Queue<EventEnvelope>(VIDEO_PROCESSING_QUEUE, {
        connection: this.redis,
      });
    }
    return this.videoQueue;
  }
}
