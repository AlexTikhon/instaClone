import { randomUUID } from 'node:crypto';

import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { eventEnvelopeSchema, type EventEnvelope } from '@instaclone/api-contracts';
import type { ApiEnvironment } from '@instaclone/config';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { OutboxQueuePublisher } from './outbox-queue.publisher';

interface ClaimedOutboxRow {
  eventId: string;
  eventName: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  correlationId: string;
  payload: unknown;
}

const DISPATCH_INTERVAL_MS = 1_000;
const CLAIM_LEASE_MS = 60_000;
const BATCH_SIZE = 20;

@Injectable()
export class OutboxDispatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly dispatcherId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: OutboxQueuePublisher,
    private readonly config: ConfigService<ApiEnvironment, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxDispatcherService.name);
  }

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => void this.tick(), DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchBatch(now = new Date()): Promise<number> {
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS);
    const rows = await this.prisma.$queryRaw<ClaimedOutboxRow[]>`
      WITH candidates AS (
        SELECT "eventId"
        FROM "outbox_events"
        WHERE "publishedAt" IS NULL
          AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
        ORDER BY "occurredAt" ASC, "eventId" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      UPDATE "outbox_events" AS events
      SET "lockedAt" = ${now},
          "lockedBy" = ${this.dispatcherId},
          "attemptCount" = events."attemptCount" + 1
      FROM candidates
      WHERE events."eventId" = candidates."eventId"
      RETURNING events."eventId", events."eventName", events."eventVersion",
        events."aggregateType", events."aggregateId", events."occurredAt",
        events."correlationId", events."payload"
    `;

    for (const row of rows) {
      try {
        const event = this.toEnvelope(row);
        await this.publisher.publish(event);
        await this.prisma.outboxEvent.updateMany({
          where: { eventId: row.eventId, lockedBy: this.dispatcherId, publishedAt: null },
          data: { publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
        });
        this.logger.info(
          {
            correlationId: event.correlationId,
            eventId: event.eventId,
            aggregateId: event.aggregateId,
            eventName: event.eventName,
          },
          'outbox event published',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 512) : 'Unknown error';
        await this.prisma.outboxEvent.updateMany({
          where: { eventId: row.eventId, lockedBy: this.dispatcherId, publishedAt: null },
          data: { lockedAt: null, lockedBy: null, lastError: message },
        });
        this.logger.warn(
          {
            correlationId: row.correlationId,
            eventId: row.eventId,
            eventName: row.eventName,
          },
          'outbox publication failed',
        );
      }
    }
    return rows.length;
  }

  private async tick(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.dispatchBatch();
    } catch (error) {
      this.logger.error({ error }, 'outbox dispatch batch failed');
    } finally {
      this.dispatching = false;
    }
  }

  private toEnvelope(row: ClaimedOutboxRow): EventEnvelope {
    return eventEnvelopeSchema.parse({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    });
  }
}
