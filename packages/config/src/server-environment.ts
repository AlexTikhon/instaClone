import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const urlSchema = z.url();

const sharedRuntimeSchema = z.object({
  NODE_ENV: environmentSchema.default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
});

const apiEnvironmentSchema = sharedRuntimeSchema.extend({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: urlSchema,
  S3_ENDPOINT: urlSchema,
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  AUTH_ACCESS_TOKEN_SECRET: z.string().min(32),
  AUTH_REFRESH_TOKEN_PEPPER: z.string().min(32),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  AUTH_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3_600)
    .max(60 * 60 * 24 * 90)
    .default(60 * 60 * 24 * 30),
  AUTH_COOKIE_SECURE: z.stringbool().default(false),
  API_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

const workerEnvironmentSchema = sharedRuntimeSchema.extend({
  REDIS_URL: urlSchema,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(100).default(4),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export const parseApiEnvironment = (input: Record<string, unknown>): ApiEnvironment =>
  apiEnvironmentSchema.parse(input);

export const parseWorkerEnvironment = (input: Record<string, unknown>): WorkerEnvironment =>
  workerEnvironmentSchema.parse(input);
