import { Worker, type Job } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import pino from 'pino';
import { Pool } from 'pg';

import {
  DOMAIN_EVENTS_QUEUE,
  COMMENT_CREATED_EVENT,
  FOLLOW_REQUESTED_EVENT,
  MEDIA_UPLOADED_EVENT,
  POST_CREATED_EVENT,
  POST_LIKED_EVENT,
  USER_FOLLOWED_EVENT,
  postCreatedEventSchema,
  type EventEnvelope,
} from '@instaclone/api-contracts';
import { parseWorkerEnvironment } from '@instaclone/config';

import {
  handlePlatformProbe,
  type PlatformProbeData,
  PLATFORM_PROBE_JOB,
  type PlatformProbeResult,
  PLATFORM_QUEUE,
} from './jobs/platform-probe.job';
import { MediaObjectStorage } from './media/media-object-storage';
import { MediaProcessingRepository } from './media/media-processing.repository';
import {
  type DomainEventHandler,
  DomainEventRouter,
  ValidatedEventHandler,
} from './domain-events/domain-event-router';
import { MediaUploadedJobHandler } from './media/media-uploaded.job';
import { NotificationProjectionRepository } from './notifications/notification-projection.repository';
import { NotificationProjector } from './notifications/notification-projector';
import { NotificationRealtimePublisher } from './notifications/notification-realtime.publisher';

const environment = parseWorkerEnvironment(process.env);
const logger = pino({
  base: { service: 'workers' },
  level: environment.LOG_LEVEL,
  redact: ['*.password', '*.token', '*.secret'],
  transport:
    environment.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
});
const redis = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null });
const realtimeRedis = redis.duplicate();
const database = new Pool({
  connectionString: environment.DATABASE_URL,
  max: environment.WORKER_CONCURRENCY + 1,
});
const s3 = new S3Client({
  endpoint: environment.S3_ENDPOINT,
  forcePathStyle: environment.S3_FORCE_PATH_STYLE,
  region: environment.S3_REGION,
  credentials: {
    accessKeyId: environment.S3_ACCESS_KEY,
    secretAccessKey: environment.S3_SECRET_KEY,
  },
});
const mediaHandler = new MediaUploadedJobHandler(
  new MediaProcessingRepository(database),
  new MediaObjectStorage(s3, environment.S3_BUCKET),
);
const notificationProjector = new NotificationProjector(
  new NotificationProjectionRepository(database),
  new NotificationRealtimePublisher(realtimeRedis),
  logger,
);
const domainEventRouter = new DomainEventRouter(
  new Map<string, DomainEventHandler>([
    [MEDIA_UPLOADED_EVENT, mediaHandler],
    [POST_CREATED_EVENT, new ValidatedEventHandler((input) => postCreatedEventSchema.parse(input))],
    [POST_LIKED_EVENT, notificationProjector],
    [COMMENT_CREATED_EVENT, notificationProjector],
    [USER_FOLLOWED_EVENT, notificationProjector],
    [FOLLOW_REQUESTED_EVENT, notificationProjector],
  ]),
);

const worker = new Worker<PlatformProbeData, PlatformProbeResult>(
  PLATFORM_QUEUE,
  (job: Job<PlatformProbeData>) => {
    if (job.name !== PLATFORM_PROBE_JOB) throw new Error(`Unsupported job type: ${job.name}`);
    return Promise.resolve(handlePlatformProbe(job.data));
  },
  {
    concurrency: environment.WORKER_CONCURRENCY,
    connection: redis,
  },
);

const domainWorker = new Worker<EventEnvelope, unknown>(
  DOMAIN_EVENTS_QUEUE,
  (job: Job<EventEnvelope>) => domainEventRouter.handle(job.name, job.data),
  { concurrency: environment.WORKER_CONCURRENCY, connection: redis },
);

worker.on('completed', (job) => {
  logger.info(
    { correlationId: job.data.correlationId, jobId: job.id, jobName: job.name },
    'job completed',
  );
});
worker.on('failed', (job, error) => {
  logger.error(
    { correlationId: job?.data.correlationId, error, jobId: job?.id, jobName: job?.name },
    'job failed',
  );
});
worker.on('error', (error) => logger.error({ error }, 'worker error'));
domainWorker.on('completed', (job, result) => {
  logger.info(
    {
      correlationId: job.data.correlationId,
      eventId: job.data.eventId,
      eventName: job.data.eventName,
      mediaId: job.data.eventName === MEDIA_UPLOADED_EVENT ? job.data.aggregateId : undefined,
      postId: job.data.eventName === POST_CREATED_EVENT ? job.data.aggregateId : undefined,
      result,
    },
    'domain event completed',
  );
});
domainWorker.on('failed', (job, error) => {
  logger.error(
    {
      correlationId: job?.data.correlationId,
      eventId: job?.data.eventId,
      eventName: job?.data.eventName,
      error,
    },
    'domain event failed',
  );
});
domainWorker.on('error', (error) => logger.error({ error }, 'domain worker error'));

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'worker shutting down');
  await Promise.all([worker.close(), domainWorker.close()]);
  await database.end();
  await Promise.all([redis.quit(), realtimeRedis.quit()]);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .catch((error: unknown) => logger.error({ error }, 'worker shutdown failed'))
      .finally(() => {
        process.exitCode = 0;
      });
  });
}

logger.info(
  { concurrency: environment.WORKER_CONCURRENCY, queues: [PLATFORM_QUEUE, DOMAIN_EVENTS_QUEUE] },
  'worker started',
);
