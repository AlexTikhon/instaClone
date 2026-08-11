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
  email: string;
  userId: string;
}

const postgresEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(postgresEnabled)('social graph PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const verificationTokens = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: (email: string, token: string) => {
          verificationTokens.set(email, token);
          return Promise.resolve();
        },
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
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'social-' } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } });
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    verificationTokens.clear();
  });

  afterAll(async () => app.close());

  const register = async (name: string): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    const email = `social-${name}-${randomUUID()}@example.com`;
    const registration = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email,
        password: 'social-secure-password',
        username: `${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        displayName: name,
      })
      .expect(201);
    const body = registration.body as { user: { id: string } };
    return { agent, csrfToken, email, userId: body.user.id };
  };

  const verify = async (actor: TestActor): Promise<void> => {
    await actor.agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', actor.csrfToken)
      .send({ token: verificationTokens.get(actor.email) })
      .expect(204);
  };

  it('enforces verification, private requests, actor ownership, and blocking invariants', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const carol = await register('carol');

    await alice.agent
      .post(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(403);
    await Promise.all([verify(alice), verify(bob), verify(carol)]);
    await carol.agent
      .patch('/api/v1/profiles/me')
      .set('x-csrf-token', carol.csrfToken)
      .send({ isPrivate: true })
      .expect(200);

    await alice.agent
      .post(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(200)
      .expect({ state: 'following' });
    await alice.agent
      .post(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(200)
      .expect({ state: 'following' });
    expect(
      await prisma.outboxEvent.count({
        where: { eventName: 'USER_FOLLOWED', aggregateId: bob.userId },
      }),
    ).toBe(1);
    await alice.agent
      .delete(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(204);
    expect(
      await prisma.follow.count({
        where: { followerId: alice.userId, followingId: bob.userId },
      }),
    ).toBe(0);
    await alice.agent
      .post(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(200);
    await bob.agent
      .post(`/api/v1/social/blocks/${alice.userId}`)
      .set('x-csrf-token', bob.csrfToken)
      .expect(204);
    expect(
      await prisma.follow.count({
        where: { followerId: alice.userId, followingId: bob.userId },
      }),
    ).toBe(0);
    await alice.agent
      .post(`/api/v1/social/follows/${bob.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(404);
    await bob.agent
      .delete(`/api/v1/social/blocks/${alice.userId}`)
      .set('x-csrf-token', bob.csrfToken)
      .expect(204);

    await alice.agent
      .post(`/api/v1/social/follows/${carol.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(200)
      .expect({ state: 'requested' });
    await bob.agent
      .post(`/api/v1/social/follows/${carol.userId}`)
      .set('x-csrf-token', bob.csrfToken)
      .expect(200)
      .expect({ state: 'requested' });
    expect(
      await prisma.outboxEvent.count({
        where: { eventName: 'FOLLOW_REQUESTED', aggregateId: carol.userId },
      }),
    ).toBe(2);
    expect(
      await prisma.follow.count({
        where: { followerId: alice.userId, followingId: carol.userId },
      }),
    ).toBe(0);
    await bob.agent
      .post(`/api/v1/social/follow-requests/${alice.userId}/accept`)
      .set('x-csrf-token', bob.csrfToken)
      .expect(404);
    const requestPage = await carol.agent.get('/api/v1/social/follow-requests?limit=1').expect(200);
    const requestBody = requestPage.body as {
      requests: { requester: { userId: string } }[];
      nextCursor: string | null;
    };
    expect(requestBody.requests).toHaveLength(1);
    expect(requestBody.nextCursor).toBeTruthy();
    const nextRequestPage = await carol.agent
      .get(`/api/v1/social/follow-requests?limit=1&cursor=${requestBody.nextCursor}`)
      .expect(200);
    expect((nextRequestPage.body as { requests: unknown[] }).requests).toHaveLength(1);
    await carol.agent
      .post(`/api/v1/social/follow-requests/${alice.userId}/accept`)
      .set('x-csrf-token', carol.csrfToken)
      .expect(200)
      .expect({ state: 'following' });
    await carol.agent
      .post(`/api/v1/social/follow-requests/${alice.userId}/accept`)
      .set('x-csrf-token', carol.csrfToken)
      .expect(200)
      .expect({ state: 'following' });
    await carol.agent
      .delete(`/api/v1/social/follow-requests/${bob.userId}`)
      .set('x-csrf-token', carol.csrfToken)
      .expect(204);
    await carol.agent
      .delete(`/api/v1/social/follow-requests/${bob.userId}`)
      .set('x-csrf-token', carol.csrfToken)
      .expect(204);
    expect(
      await prisma.follow.count({
        where: { followerId: alice.userId, followingId: carol.userId },
      }),
    ).toBe(1);

    await alice.agent
      .post(`/api/v1/social/blocks/${carol.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(204);
    expect(
      await prisma.follow.count({
        where: {
          OR: [
            { followerId: alice.userId, followingId: carol.userId },
            { followerId: carol.userId, followingId: alice.userId },
          ],
        },
      }),
    ).toBe(0);
    expect(
      await prisma.followRequest.count({
        where: {
          OR: [
            { requesterId: alice.userId, targetId: carol.userId },
            { requesterId: carol.userId, targetId: alice.userId },
          ],
        },
      }),
    ).toBe(0);
    await alice.agent
      .post(`/api/v1/social/follows/${alice.userId}`)
      .set('x-csrf-token', alice.csrfToken)
      .expect(400);
  });

  it('refuses acceptance when the requester is no longer an active valid account', async () => {
    const requester = await register('disreq');
    const target = await register('privtarget');
    await Promise.all([verify(requester), verify(target)]);
    await target.agent
      .patch('/api/v1/profiles/me')
      .set('x-csrf-token', target.csrfToken)
      .send({ isPrivate: true })
      .expect(200);
    await requester.agent
      .post(`/api/v1/social/follows/${target.userId}`)
      .set('x-csrf-token', requester.csrfToken)
      .expect(200);
    await prisma.user.update({ where: { id: requester.userId }, data: { disabledAt: new Date() } });
    await target.agent
      .post(`/api/v1/social/follow-requests/${requester.userId}/accept`)
      .set('x-csrf-token', target.csrfToken)
      .expect(404);
    expect(
      await prisma.follow.count({
        where: { followerId: requester.userId, followingId: target.userId },
      }),
    ).toBe(0);
  });
});
