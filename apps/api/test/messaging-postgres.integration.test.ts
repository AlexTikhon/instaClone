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

describe.runIf(postgresEnabled)('messaging PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const verificationTokens = new Map<string, string>();
  const userIds: string[] = [];

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
    await prisma.outboxEvent.deleteMany({ where: { eventName: 'MESSAGE_CREATED' } });
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    verificationTokens.clear();
    userIds.length = 0;
  });

  afterAll(async () => app.close());

  const register = async (name: string): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrfResponse.body as { csrfToken: string }).csrfToken;
    const email = `messaging-${name}-${randomUUID()}@example.com`;
    const registration = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email,
        password: 'messaging-secure-password',
        username: `${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        displayName: name,
      })
      .expect(201);
    const userId = (registration.body as { user: { id: string } }).user.id;
    userIds.push(userId);
    await agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', csrfToken)
      .send({ token: verificationTokens.get(email) })
      .expect(204);
    return { agent, csrfToken, email, userId };
  };

  const create = async (actor: TestActor, peer: TestActor): Promise<string> => {
    const response = await actor.agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', actor.csrfToken)
      .send({ participantUserId: peer.userId })
      .expect(200);
    return (response.body as { id: string }).id;
  };

  const send = (
    actor: TestActor,
    conversationId: string,
    text: string,
    clientMessageId = randomUUID(),
  ) =>
    actor.agent
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('x-csrf-token', actor.csrfToken)
      .send({ text, clientMessageId });

  it('converges duplicate and opposite-direction conversation races', async () => {
    const alice = await register('race_alice');
    const bob = await register('race_bob');
    const carol = await register('race_carol');
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? alice : bob).agent
          .post('/api/v1/conversations')
          .set('x-csrf-token', (index % 2 === 0 ? alice : bob).csrfToken)
          .send({ participantUserId: (index % 2 === 0 ? bob : alice).userId }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const ids = new Set(responses.map((response) => (response.body as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(
      await prisma.conversation.count({
        where: {
          OR: [
            { lowerUserId: alice.userId, higherUserId: bob.userId },
            { lowerUserId: bob.userId, higherUserId: alice.userId },
          ],
        },
      }),
    ).toBe(1);

    await alice.agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', alice.csrfToken)
      .send({ participantUserId: alice.userId })
      .expect(400);
    await carol.agent.get(`/api/v1/conversations/${[...ids][0]}`).expect(404);
    await carol.agent.get(`/api/v1/conversations/${[...ids][0]}/messages`).expect(404);

    await bob.agent
      .post(`/api/v1/social/blocks/${alice.userId}`)
      .set('x-csrf-token', bob.csrfToken)
      .expect(204);
    await alice.agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', alice.csrfToken)
      .send({ participantUserId: bob.userId })
      .expect(404);
  });

  it('orders conversation activity and keeps a cursor chain on its original snapshot', async () => {
    const alice = await register('list_alice');
    const bob = await register('list_bob');
    const carol = await register('list_carol');
    const bobConversation = await create(alice, bob);
    const carolConversation = await create(alice, carol);
    const bobMessage = await send(alice, bobConversation, 'older preview').expect(200);
    const carolMessage = await send(alice, carolConversation, 'newer preview').expect(200);
    await prisma.message.update({
      where: { id: (bobMessage.body as { id: string }).id },
      data: { createdAt: new Date('2026-08-12T08:00:00.000Z') },
    });
    await prisma.message.update({
      where: { id: (carolMessage.body as { id: string }).id },
      data: { createdAt: new Date('2026-08-12T09:00:00.000Z') },
    });

    const first = await alice.agent.get('/api/v1/conversations?limit=1').expect(200);
    const firstBody = first.body as {
      items: { id: string }[];
      nextCursor: string;
      hasMore: boolean;
    };
    expect(firstBody.items.map((item) => item.id)).toEqual([carolConversation]);
    expect(firstBody.hasMore).toBe(true);

    await send(bob, bobConversation, 'arrived after snapshot').expect(200);
    const second = await alice.agent
      .get(`/api/v1/conversations?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`)
      .expect(200);
    expect((second.body as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([
      bobConversation,
    ]);

    await carol.agent
      .post(`/api/v1/conversations/${bobConversation}/read`)
      .set('x-csrf-token', carol.csrfToken)
      .send({ messageId: (bobMessage.body as { id: string }).id })
      .expect(404);
  });

  it('orders, paginates, deduplicates sends, and advances read watermarks monotonically', async () => {
    const alice = await register('messages_alice');
    const bob = await register('messages_bob');
    const conversationId = await create(alice, bob);
    const retryKey = randomUUID();
    const duplicateResponses = await Promise.all([
      send(alice, conversationId, 'hello', retryKey),
      send(alice, conversationId, 'hello', retryKey),
    ]);
    expect(duplicateResponses.every((response) => response.status === 200)).toBe(true);
    expect(
      new Set(duplicateResponses.map((response) => (response.body as { id: string }).id)).size,
    ).toBe(1);
    expect(
      await prisma.message.count({ where: { senderId: alice.userId, clientMessageId: retryKey } }),
    ).toBe(1);
    await send(alice, conversationId, 'different body', retryKey).expect(409);
    await send(alice, conversationId, '   ', randomUUID()).expect(400);

    const simultaneous = await Promise.all([
      send(alice, conversationId, 'from alice').expect(200),
      send(bob, conversationId, 'from bob').expect(200),
    ]);
    const allRows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { sequence: 'asc' },
    });
    expect(allRows.map((row) => Number(row.sequence))).toEqual([1, 2, 3]);
    expect(new Set(allRows.map((row) => row.sequence.toString())).size).toBe(3);
    expect(await prisma.outboxEvent.count({ where: { eventName: 'MESSAGE_CREATED' } })).toBe(3);

    const firstPage = await alice.agent
      .get(`/api/v1/conversations/${conversationId}/messages?limit=2`)
      .expect(200);
    const firstBody = firstPage.body as {
      items: { id: string; sequence: number }[];
      nextCursor: string;
      hasMore: boolean;
    };
    expect(firstBody.items.map((item) => item.sequence)).toEqual([3, 2]);
    expect(firstBody.hasMore).toBe(true);
    const olderPage = await alice.agent
      .get(
        `/api/v1/conversations/${conversationId}/messages?limit=2&before=${encodeURIComponent(firstBody.nextCursor)}`,
      )
      .expect(200);
    const olderItems = (olderPage.body as { items: { id: string; sequence: number }[] }).items;
    expect(olderItems.map((item) => item.sequence)).toEqual([1]);
    expect(new Set([...firstBody.items, ...olderItems].map((item) => item.id)).size).toBe(3);

    const incomingForBob = allRows.filter((row) => row.senderId === alice.userId);
    const newestIncoming = incomingForBob.at(-1)!;
    const oldestIncoming = incomingForBob[0]!;
    const readResponses = await Promise.all([
      bob.agent
        .post(`/api/v1/conversations/${conversationId}/read`)
        .set('x-csrf-token', bob.csrfToken)
        .send({ messageId: newestIncoming.id }),
      bob.agent
        .post(`/api/v1/conversations/${conversationId}/read`)
        .set('x-csrf-token', bob.csrfToken)
        .send({ messageId: oldestIncoming.id }),
    ]);
    expect(readResponses.every((response) => response.status === 200)).toBe(true);
    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    const bobRead =
      stored.lowerUserId === bob.userId
        ? stored.lowerLastReadSequence
        : stored.higherLastReadSequence;
    expect(bobRead).toBe(stored.lastSequence);

    const list = await bob.agent.get('/api/v1/conversations').expect(200);
    expect(
      (list.body as { items: { id: string; unreadCount: number }[] }).items.find(
        (item) => item.id === conversationId,
      )?.unreadCount,
    ).toBe(0);
    expect(simultaneous).toHaveLength(2);
  });

  it('keeps history visible after a block and linearizes block/send races', async () => {
    const alice = await register('block_alice');
    const bob = await register('block_bob');
    const conversationId = await create(alice, bob);
    await send(alice, conversationId, 'historical').expect(200);

    const raceKey = randomUUID();
    const [sendResponse, blockResponse] = await Promise.all([
      send(alice, conversationId, 'racing send', raceKey),
      bob.agent.post(`/api/v1/social/blocks/${alice.userId}`).set('x-csrf-token', bob.csrfToken),
    ]);
    expect(blockResponse.status).toBe(204);
    expect([200, 403]).toContain(sendResponse.status);
    expect(
      await prisma.message.count({ where: { senderId: alice.userId, clientMessageId: raceKey } }),
    ).toBe(sendResponse.status === 200 ? 1 : 0);
    await send(alice, conversationId, 'after block').expect(403);

    const detail = await alice.agent.get(`/api/v1/conversations/${conversationId}`).expect(200);
    expect((detail.body as { blocked: boolean }).blocked).toBe(true);
    const history = await alice.agent
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .expect(200);
    expect((history.body as { items: { text: string }[] }).items).toContainEqual(
      expect.objectContaining({ text: 'historical' }),
    );
  });
});
