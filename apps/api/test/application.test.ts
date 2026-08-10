import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';

import {
  errorEnvelopeSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from '@instaclone/api-contracts';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';

describe('platform HTTP API', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const databasePing = vi.fn<() => Promise<void>>();
  const redisPing = vi.fn<() => Promise<void>>();
  const objectStoragePing = vi.fn<() => Promise<void>>();

  beforeAll(async () => {
    databasePing.mockResolvedValue(undefined);
    redisPing.mockResolvedValue(undefined);
    objectStoragePing.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ping: databasePing })
      .overrideProvider(RedisService)
      .useValue({ ping: redisPing })
      .overrideProvider(ObjectStorageService)
      .useValue({ ping: objectStoragePing })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  it('serves readiness when every infrastructure probe succeeds', async () => {
    const response = await request(server).get('/api/v1/health/ready').expect(200);
    expect(readinessResponseSchema.parse(response.body).status).toBe('ready');
  });

  it('returns 503 readiness while retaining failed dependency detail', async () => {
    redisPing.mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await request(server).get('/api/v1/health/ready').expect(503);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'not_ready',
      dependencies: { redis: { status: 'down' } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness and propagates a valid request ID', async () => {
    const response = await request(server)
      .get('/api/v1/health/live')
      .set('x-request-id', 'test-request-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('test-request-123');
    expect(livenessResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      service: 'api',
    });
  });

  it('returns the stable error envelope for an unknown route', async () => {
    const response = await request(server).get('/api/v1/missing').expect(404);
    const body = errorEnvelopeSchema.parse(response.body);

    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(body.error.requestId).not.toBe('unknown');
  });
});
