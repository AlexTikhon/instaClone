import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AuthEmailService } from '../src/auth/auth-email.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';

interface TestActor {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  userId: string;
}

const postgresEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(postgresEnabled)('notifications PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: () => Promise.resolve(),
        sendPasswordReset: () => Promise.resolve(),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve(), consumeRateLimit: () => Promise.resolve(60) })
      .overrideProvider(ObjectStorageService)
      .useValue({ ping: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterEach(async () => {
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => app.close());

  const register = async (name: string): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const registration = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email: `notification-${name}-${randomUUID()}@example.com`,
        password: 'notification-secure-password',
        username: `${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        displayName: name,
      })
      .expect(201);
    const userId = (registration.body as { user: { id: string } }).user.id;
    userIds.push(userId);
    return { agent, csrfToken, userId };
  };

  it('isolates recipients, paginates stably, and persists idempotent read state', async () => {
    const recipient = await register('recipient');
    const other = await register('other');
    const now = Date.now();
    const own = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.notification.create({
          data: {
            sourceEventId: randomUUID(),
            recipientId: recipient.userId,
            actorId: other.userId,
            type: 'FOLLOW',
            actorUsername: 'other',
            actorDisplayName: 'Other',
            createdAt: new Date(now - index * 1_000),
          },
        }),
      ),
    );
    const foreign = await prisma.notification.create({
      data: {
        sourceEventId: randomUUID(),
        recipientId: other.userId,
        actorId: recipient.userId,
        type: 'FOLLOW',
        actorUsername: 'recipient',
        actorDisplayName: 'Recipient',
      },
    });

    const first = await recipient.agent.get('/api/v1/notifications?limit=2').expect(200);
    const firstBody = first.body as {
      items: { id: string }[];
      nextCursor: string;
      hasMore: boolean;
      unreadCount: number;
    };
    expect(firstBody).toMatchObject({ hasMore: true, unreadCount: 3 });
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.items.some((item) => item.id === foreign.id)).toBe(false);
    const second = await recipient.agent
      .get(`/api/v1/notifications?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`)
      .expect(200);
    const secondIds = (second.body as { items: { id: string }[] }).items.map((item) => item.id);
    expect(secondIds).toHaveLength(1);
    expect(new Set([...firstBody.items.map((item) => item.id), ...secondIds]).size).toBe(3);

    const firstRead = await recipient.agent
      .put(`/api/v1/notifications/${own[0]?.id}/read`)
      .set('x-csrf-token', recipient.csrfToken)
      .expect(200);
    const readAt = (firstRead.body as { readAt: string }).readAt;
    const repeated = await recipient.agent
      .put(`/api/v1/notifications/${own[0]?.id}/read`)
      .set('x-csrf-token', recipient.csrfToken)
      .expect(200);
    expect((repeated.body as { readAt: string }).readAt).toBe(readAt);

    const foreignRead = await recipient.agent
      .put(`/api/v1/notifications/${foreign.id}/read`)
      .set('x-csrf-token', recipient.csrfToken)
      .expect(404);
    expect((foreignRead.body as { error: { code: string } }).error.code).toBe(
      'NOTIFICATION_NOT_FOUND',
    );
    const markAll = await recipient.agent
      .put('/api/v1/notifications/read-all')
      .set('x-csrf-token', recipient.csrfToken)
      .expect(200);
    expect((markAll.body as { updatedCount: number }).updatedCount).toBe(2);
    expect(
      await prisma.notification.count({ where: { recipientId: recipient.userId, readAt: null } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { recipientId: other.userId, readAt: null } }),
    ).toBe(1);
  });
});
