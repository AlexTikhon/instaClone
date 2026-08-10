import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AuthCleanupService } from '../src/auth/auth-cleanup.service';
import { AuthEmailService } from '../src/auth/auth-email.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';

const postgresEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(postgresEnabled)('authentication PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let email: string;
  const delivered = { verification: [] as string[], resets: [] as string[] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: (_email: string, token: string) => {
          delivered.verification.push(token);
          return Promise.resolve();
        },
        sendPasswordReset: (_email: string, token: string) => {
          delivered.resets.push(token);
          return Promise.resolve();
        },
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

  beforeEach(() => {
    email = `postgres-${randomUUID()}@example.com`;
    delivered.verification.length = 0;
    delivered.resets.length = 0;
  });

  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'postgres-' } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => app.close());

  it('persists and atomically transitions verification, reset, sessions, and audit state', async () => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .set('user-agent', 'postgres-integration')
      .send({
        email,
        password: 'initial-secure-password',
        username: `pg_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
        displayName: 'Postgres Test',
      })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: {
        credential: true,
        profile: true,
        sessions: { include: { refreshTokens: true } },
        emailVerificationTokens: true,
        auditEvents: true,
      },
    });
    expect(user.credential).toBeTruthy();
    expect(user.profile).toBeTruthy();
    expect(user.sessions).toHaveLength(1);
    expect(user.sessions[0]?.refreshTokens).toHaveLength(1);
    expect(user.sessions[0]?.userAgent).toBe('postgres-integration');
    expect(user.emailVerificationTokens).toHaveLength(1);
    expect(user.auditEvents.some((event) => event.eventType === 'REGISTER')).toBe(true);

    await agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', csrfToken)
      .send({ token: delivered.verification.at(-1) })
      .expect(204);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).not.toBeNull();

    await agent
      .post('/api/v1/auth/password/forgot')
      .set('x-csrf-token', csrfToken)
      .send({ email })
      .expect(202);
    await agent
      .post('/api/v1/auth/password/reset')
      .set('x-csrf-token', csrfToken)
      .send({ token: delivered.resets.at(-1), newPassword: 'reset-secure-password' })
      .expect(204);
    expect(
      await prisma.authSession.count({ where: { userId: user.id, revokedAt: { not: null } } }),
    ).toBe(1);
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: user.id, consumedAt: { not: null } },
      }),
    ).toBe(1);

    await prisma.authSession.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await app.get(AuthCleanupService).run(new Date());
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await prisma.authAuditEvent.count({
        where: { userId: user.id, eventType: 'PASSWORD_RESET_COMPLETED' },
      }),
    ).toBe(1);
  });
});
