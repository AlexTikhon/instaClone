import { Worker, type Job } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import Redis from 'ioredis';
import pino from 'pino';
import { Pool } from 'pg';

import {
  DOMAIN_EVENTS_QUEUE,
  COMMENT_CREATED_EVENT,
  ACCOUNT_SUSPENDED_EVENT,
  accountSuspendedEventSchema,
  CONTENT_MODERATED_EVENT,
  contentModeratedEventSchema,
  FOLLOW_REQUESTED_EVENT,
  MEDIA_UPLOADED_EVENT,
  MESSAGE_CREATED_EVENT,
  POST_CREATED_EVENT,
  POST_LIKED_EVENT,
  STORY_CREATED_EVENT,
  USER_FOLLOWED_EVENT,
  VIDEO_PROCESSING_QUEUE,
  VIDEO_UPLOADED_EVENT,
  postCreatedEventSchema,
  storyCreatedEventSchema,
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
import { VideoUploadedJobHandler } from './media/video-uploaded.job';
import { NotificationProjectionRepository } from './notifications/notification-projection.repository';
import { NotificationProjector } from './notifications/notification-projector';
import { NotificationRealtimePublisher } from './notifications/notification-realtime.publisher';
import { StoryRetentionJob } from './stories/story-retention.job';
import { MessageCreatedHandler } from './messaging/message-created.handler';
import { MessageRealtimePublisher } from './messaging/message-realtime.publisher';

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
const mediaRepository = new MediaProcessingRepository(database);
const mediaStorage = new MediaObjectStorage(s3, environment.S3_BUCKET);
const mediaHandler = new MediaUploadedJobHandler(mediaRepository, mediaStorage);
const videoHandler = new VideoUploadedJobHandler(mediaRepository, mediaStorage, {
  ffmpegPath: environment.FFMPEG_PATH,
  ffprobePath: environment.FFPROBE_PATH,
  timeoutMs: environment.VIDEO_PROCESSING_TIMEOUT_MS,
});
const notificationProjector = new NotificationProjector(
  new NotificationProjectionRepository(database),
  new NotificationRealtimePublisher(realtimeRedis),
  logger,
);
const messageCreatedHandler = new MessageCreatedHandler(
  new MessageRealtimePublisher(realtimeRedis),
  logger,
);
const domainEventRouter = new DomainEventRouter(
  new Map<string, DomainEventHandler>([
    [MEDIA_UPLOADED_EVENT, mediaHandler],
    [POST_CREATED_EVENT, new ValidatedEventHandler((input) => postCreatedEventSchema.parse(input))],
    [
      STORY_CREATED_EVENT,
      new ValidatedEventHandler((input) => storyCreatedEventSchema.parse(input)),
    ],
    [POST_LIKED_EVENT, notificationProjector],
    [COMMENT_CREATED_EVENT, notificationProjector],
    [USER_FOLLOWED_EVENT, notificationProjector],
    [FOLLOW_REQUESTED_EVENT, notificationProjector],
    [MESSAGE_CREATED_EVENT, messageCreatedHandler],
    [
      CONTENT_MODERATED_EVENT,
      new ValidatedEventHandler((input) => contentModeratedEventSchema.parse(input)),
    ],
    [
      ACCOUNT_SUSPENDED_EVENT,
      new ValidatedEventHandler((input) => accountSuspendedEventSchema.parse(input)),
    ],
  ]),
);
const storyRetention = new StoryRetentionJob(database);
const runStoryRetention = async (): Promise<void> => {
  try {
    const deletedCount = await storyRetention.run();
    logger.info({ deletedCount }, 'story retention completed');
  } catch (error) {
    logger.error({ error }, 'story retention failed');
  }
};
const storyRetentionTimer = setInterval(() => void runStoryRetention(), 60 * 60 * 1_000);
storyRetentionTimer.unref();
void runStoryRetention();

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

const videoWorker = new Worker<EventEnvelope, unknown>(
  VIDEO_PROCESSING_QUEUE,
  (job: Job<EventEnvelope>) => {
    if (job.name !== VIDEO_UPLOADED_EVENT) {
      throw new Error(`Unsupported video job type: ${job.name}`);
    }
    const maximumAttempts = job.opts.attempts ?? 1;
    return videoHandler.handle(job.data, {
      finalAttempt: job.attemptsMade + 1 >= maximumAttempts,
    });
  },
  { concurrency: environment.VIDEO_PROCESSING_CONCURRENCY, connection: redis },
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
      storyId: job.data.eventName === STORY_CREATED_EVENT ? job.data.aggregateId : undefined,
      messageId: job.data.eventName === MESSAGE_CREATED_EVENT ? job.data.aggregateId : undefined,
      moderationCaseId:
        job.data.eventName === CONTENT_MODERATED_EVENT ||
        job.data.eventName === ACCOUNT_SUSPENDED_EVENT
          ? job.data.aggregateId
          : undefined,
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
videoWorker.on('completed', (job, result) => {
  logger.info(
    {
      correlationId: job.data.correlationId,
      eventId: job.data.eventId,
      mediaId: job.data.aggregateId,
      attempt: job.attemptsMade,
      result,
    },
    'video processing completed',
  );
});
videoWorker.on('failed', (job, error) => {
  logger.error(
    {
      correlationId: job?.data.correlationId,
      eventId: job?.data.eventId,
      mediaId: job?.data.aggregateId,
      attempt: job?.attemptsMade,
      error,
    },
    'video processing failed',
  );
});
videoWorker.on('error', (error) => logger.error({ error }, 'video worker error'));

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'worker shutting down');
  clearInterval(storyRetentionTimer);
  await Promise.all([worker.close(), domainWorker.close(), videoWorker.close()]);
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
  {
    concurrency: environment.WORKER_CONCURRENCY,
    videoProcessingConcurrency: environment.VIDEO_PROCESSING_CONCURRENCY,
    queues: [PLATFORM_QUEUE, DOMAIN_EVENTS_QUEUE, VIDEO_PROCESSING_QUEUE],
  },
  'worker started',
);
