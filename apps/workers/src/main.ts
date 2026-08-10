import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';

import { parseWorkerEnvironment } from '@instaclone/config';

import {
  handlePlatformProbe,
  type PlatformProbeData,
  PLATFORM_PROBE_JOB,
  type PlatformProbeResult,
  PLATFORM_QUEUE,
} from './jobs/platform-probe.job';

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

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  await redis.quit();
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
  { concurrency: environment.WORKER_CONCURRENCY, queue: PLATFORM_QUEUE },
  'worker started',
);
