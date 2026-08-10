Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'test-access',
  S3_SECRET_KEY: 'test-secret',
  S3_BUCKET: 'test-media',
  AUTH_ACCESS_TOKEN_SECRET: 'test-access-token-secret-at-least-32-characters',
  AUTH_REFRESH_TOKEN_PEPPER: 'test-refresh-token-pepper-at-least-32-characters',
});
