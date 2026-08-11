import { describe, expect, it } from 'vitest';

import { parseApiEnvironment } from './server-environment';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
  S3_BUCKET: 'media-bucket',
  AUTH_ACCESS_TOKEN_SECRET: 'access-token-secret-at-least-32-characters',
  AUTH_REFRESH_TOKEN_PEPPER: 'refresh-token-pepper-at-least-32-characters',
};

describe('server environment', () => {
  it('parses defaults and comma-separated CORS origins', () => {
    const parsed = parseApiEnvironment({
      ...validEnvironment,
      API_CORS_ORIGINS: 'https://one.example, https://two.example',
    });

    expect(parsed.API_PORT).toBe(4000);
    expect(parsed.AUTH_ACCESS_TTL_SECONDS).toBe(900);
    expect(parsed.API_CORS_ORIGINS).toEqual(['https://one.example', 'https://two.example']);
  });

  it('fails fast when a required secret is absent', () => {
    expect(() => parseApiEnvironment({ ...validEnvironment, S3_SECRET_KEY: undefined })).toThrow();
  });

  it('rejects insecure cookies and development secrets in production', () => {
    expect(() =>
      parseApiEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'false',
        WEB_APP_URL: 'http://example.com',
      }),
    ).toThrow();
  });

  it('accepts distinct managed secrets and secure production URLs', () => {
    const parsed = parseApiEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'true',
      AUTH_ACCESS_TOKEN_SECRET: 'A'.repeat(64),
      AUTH_REFRESH_TOKEN_PEPPER: 'B'.repeat(64),
      WEB_APP_URL: 'https://app.example.com',
    });
    expect(parsed.AUTH_COOKIE_SECURE).toBe(true);
  });

  it('requires durable and object-storage dependencies for workers', async () => {
    const { parseWorkerEnvironment } = await import('./server-environment');
    expect(() => parseWorkerEnvironment({ REDIS_URL: 'redis://localhost:6379' })).toThrow();
    expect(
      parseWorkerEnvironment({
        ...validEnvironment,
        WORKER_CONCURRENCY: '2',
      }).WORKER_CONCURRENCY,
    ).toBe(2);
  });
});
