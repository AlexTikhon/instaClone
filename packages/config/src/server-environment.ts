import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const urlSchema = z.url();

const sharedRuntimeSchema = z.object({
  NODE_ENV: environmentSchema.default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
});

const apiEnvironmentSchema = sharedRuntimeSchema
  .extend({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: urlSchema,
    S3_ENDPOINT: urlSchema,
    S3_PUBLIC_ENDPOINT: urlSchema.optional(),
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
    AUTH_EMAIL_VERIFICATION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(60 * 60 * 24 * 7)
      .default(60 * 60 * 24),
    AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
    AUTH_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(3_600),
    AUTH_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(730).default(180),
    AUTH_SMTP_URL: z.string().url().default('smtp://localhost:1025'),
    AUTH_EMAIL_FROM: z.email().default('no-reply@instaclone.local'),
    WEB_APP_URL: urlSchema.default('http://localhost:3000'),
    API_CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;

    if (!environment.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'Secure cookies are required in production',
      });
    }

    for (const key of ['AUTH_ACCESS_TOKEN_SECRET', 'AUTH_REFRESH_TOKEN_PEPPER'] as const) {
      const secret = environment[key];
      if (secret.length < 48 || /(?:change-me|local|example|test)/i.test(secret)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Production authentication secrets must be strong managed values',
        });
      }
    }

    if (environment.AUTH_ACCESS_TOKEN_SECRET === environment.AUTH_REFRESH_TOKEN_PEPPER) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_TOKEN_PEPPER'],
        message: 'Access and refresh secrets must be distinct',
      });
    }
    if (!environment.WEB_APP_URL.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'The production web application URL must use HTTPS',
      });
    }
  });

const workerEnvironmentSchema = sharedRuntimeSchema.extend({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: urlSchema,
  S3_ENDPOINT: urlSchema,
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(100).default(4),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export const parseApiEnvironment = (input: Record<string, unknown>): ApiEnvironment =>
  apiEnvironmentSchema.parse(input);

export const parseWorkerEnvironment = (input: Record<string, unknown>): WorkerEnvironment =>
  workerEnvironmentSchema.parse(input);
