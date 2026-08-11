import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MAX_IMAGE_UPLOAD_BYTES } from '@instaclone/api-contracts';

import { AppModule } from '../src/app.module';
import { AuthEmailService } from '../src/auth/auth-email.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import { OutboxQueuePublisher } from '../src/outbox/outbox-queue.publisher';

interface TestActor {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  email: string;
  userId: string;
}

interface InitializedMedia {
  id: string;
  objectKey: string;
}

const postgresEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(postgresEnabled)('media and posts PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const verificationTokens = new Map<string, string>();
  const storedObjects = new Map<string, { contentLength: number; contentType: string }>();
  const publishedEvents: { eventId: string }[] = [];

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
      .useValue({
        ping: () => Promise.resolve(),
        createUploadUrl: ({ objectKey }: { objectKey: string }) =>
          Promise.resolve(`http://storage.local/${objectKey}`),
        headObject: (objectKey: string) => {
          const object = storedObjects.get(objectKey);
          return object
            ? Promise.resolve(object)
            : Promise.reject(
                Object.assign(new Error('Object not found'), {
                  $metadata: { httpStatusCode: 404 },
                }),
              );
        },
        createDownloadUrl: (objectKey: string) =>
          Promise.resolve(`https://media.example/${objectKey}?signed=true`),
      })
      .overrideProvider(OutboxQueuePublisher)
      .useValue({
        publish: (event: { eventId: string }) => {
          publishedEvents.push(event);
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'phase3-' } },
      select: { id: true, mediaAssets: { select: { id: true } }, posts: { select: { id: true } } },
    });
    const aggregateIds = users.flatMap((user) => [
      ...user.mediaAssets.map((media) => media.id),
      ...user.posts.map((post) => post.id),
    ]);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: aggregateIds } } });
    await prisma.authAuditEvent.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    const userIds = users.map((user) => user.id);
    await prisma.post.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    verificationTokens.clear();
    storedObjects.clear();
    publishedEvents.length = 0;
  });

  afterAll(async () => app.close());

  const register = async (name: string): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const email = `phase3-${name}-${randomUUID()}@example.com`;
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email,
        password: 'phase-three-secure-password',
        username: `${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        displayName: name,
      })
      .expect(201);
    return {
      agent,
      csrfToken,
      email,
      userId: (response.body as { user: { id: string } }).user.id,
    };
  };

  const verify = async (actor: TestActor): Promise<void> => {
    await actor.agent
      .post('/api/v1/auth/email/verify')
      .set('x-csrf-token', actor.csrfToken)
      .send({ token: verificationTokens.get(actor.email) })
      .expect(204);
  };

  const initialize = async (actor: TestActor, sizeBytes = 1024): Promise<InitializedMedia> => {
    const response = await actor.agent
      .post('/api/v1/media/uploads')
      .set('x-csrf-token', actor.csrfToken)
      .send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes })
      .expect(201);
    const id = (response.body as { media: { id: string } }).media.id;
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    return { id, objectKey: asset.objectKey };
  };

  const readyAsset = (ownerId: string) => {
    const id = randomUUID();
    return prisma.mediaAsset.create({
      data: {
        id,
        ownerId,
        kind: 'IMAGE',
        objectKey: `users/${ownerId}/media/${id}/original`,
        thumbnailObjectKey: `users/${ownerId}/media/${id}/thumb-640`,
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 1024,
        verifiedSizeBytes: 1024,
        width: 100,
        height: 100,
        status: 'READY',
      },
    });
  };

  it('rejects unauthenticated, unsupported, and oversized upload initialization', async () => {
    await request(server)
      .post('/api/v1/media/uploads')
      .send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 100 })
      .expect(401);
    const actor = await register('validation');
    await verify(actor);
    await actor.agent
      .post('/api/v1/media/uploads')
      .set('x-csrf-token', actor.csrfToken)
      .send({ kind: 'IMAGE', mimeType: 'image/svg+xml', sizeBytes: 100 })
      .expect(400);
    await actor.agent
      .post('/api/v1/media/uploads')
      .set('x-csrf-token', actor.csrfToken)
      .send({ kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: MAX_IMAGE_UPLOAD_BYTES + 1 })
      .expect(400);
  });

  it('binds upload ownership to the actor and verifies storage before finalization', async () => {
    const [alice, bob] = await Promise.all([register('owner'), register('intruder')]);
    await Promise.all([verify(alice), verify(bob)]);
    const media = await initialize(alice, 2048);
    expect(media.objectKey).toBe(`users/${alice.userId}/media/${media.id}/original`);
    await bob.agent
      .post(`/api/v1/media/${media.id}/finalize`)
      .set('x-csrf-token', bob.csrfToken)
      .send({})
      .expect(404)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'MEDIA_NOT_FOUND' } }),
      );
    await alice.agent
      .post(`/api/v1/media/${media.id}/finalize`)
      .set('x-csrf-token', alice.csrfToken)
      .send({})
      .expect(400)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'MEDIA_UPLOAD_INVALID' } }),
      );
    storedObjects.set(media.objectKey, { contentLength: 2048, contentType: 'image/png' });
    await alice.agent
      .post(`/api/v1/media/${media.id}/finalize`)
      .set('x-csrf-token', alice.csrfToken)
      .send({})
      .expect(400);
  });

  it('atomically finalizes media and creates an ordered post with durable events', async () => {
    const [alice, bob] = await Promise.all([register('author'), register('other')]);
    await Promise.all([verify(alice), verify(bob)]);
    const media = await initialize(alice);
    storedObjects.set(media.objectKey, { contentLength: 1024, contentType: 'image/jpeg' });
    await alice.agent
      .post(`/api/v1/media/${media.id}/finalize`)
      .set('x-csrf-token', alice.csrfToken)
      .set('x-request-id', 'phase3-upload-request')
      .send({})
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({ id: media.id, status: 'UPLOADED' }),
      );
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: media.id } })).toMatchObject({
      eventName: 'MEDIA_UPLOADED',
      correlationId: 'phase3-upload-request',
    });

    await bob.agent
      .post('/api/v1/posts')
      .set('x-csrf-token', bob.csrfToken)
      .send({ caption: 'stolen', mediaAssetIds: [media.id] })
      .expect(403)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'MEDIA_NOT_OWNED' } }),
      );
    await alice.agent
      .post('/api/v1/posts')
      .set('x-csrf-token', alice.csrfToken)
      .send({ caption: 'too early', mediaAssetIds: [media.id] })
      .expect(409)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'MEDIA_NOT_READY' } }),
      );

    await prisma.mediaAsset.update({
      where: { id: media.id },
      data: {
        status: 'READY',
        thumbnailObjectKey: `users/${alice.userId}/media/${media.id}/thumb-640`,
        width: 100,
        height: 80,
      },
    });
    const created = await alice.agent
      .post('/api/v1/posts')
      .set('x-csrf-token', alice.csrfToken)
      .set('x-request-id', 'phase3-post-request')
      .send({ caption: ' first post ', mediaAssetIds: [media.id] })
      .expect(201);
    const postId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      caption: 'first post',
      media: [{ id: media.id, position: 0 }],
    });
    const persisted = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: { media: true },
    });
    expect(persisted.media).toHaveLength(1);
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: postId } })).toMatchObject({
      eventName: 'POST_CREATED',
      correlationId: 'phase3-post-request',
    });
    expect(await app.get(OutboxDispatcherService).dispatchBatch()).toBe(2);
    expect(publishedEvents).toHaveLength(2);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: { in: [media.id, postId] }, publishedAt: { not: null } },
      }),
    ).toBe(2);

    const postCount = await prisma.post.count({ where: { authorId: alice.userId } });
    await alice.agent
      .post('/api/v1/posts')
      .set('x-csrf-token', alice.csrfToken)
      .send({ caption: 'duplicate', mediaAssetIds: [media.id] })
      .expect(409);
    expect(await prisma.post.count({ where: { authorId: alice.userId } })).toBe(postCount);
  });

  it('uses a stable cursor for author posts and enforces private-account visibility', async () => {
    const [author, viewer] = await Promise.all([register('timeline'), register('viewer')]);
    await Promise.all([verify(author), verify(viewer)]);
    const first = await readyAsset(author.userId);
    const second = await readyAsset(author.userId);
    for (const media of [first, second]) {
      await author.agent
        .post('/api/v1/posts')
        .set('x-csrf-token', author.csrfToken)
        .send({ caption: media.id, mediaAssetIds: [media.id] })
        .expect(201);
    }
    const firstPage = await viewer.agent
      .get(`/api/v1/posts?authorId=${author.userId}&limit=1`)
      .expect(200);
    const body = firstPage.body as { posts: { id: string }[]; nextCursor: string | null };
    expect(body.posts).toHaveLength(1);
    expect(body.nextCursor).toBeTruthy();
    const secondPage = await viewer.agent
      .get(`/api/v1/posts?authorId=${author.userId}&limit=1&cursor=${body.nextCursor}`)
      .expect(200);
    expect((secondPage.body as { posts: { id: string }[] }).posts[0]?.id).not.toBe(
      body.posts[0]?.id,
    );

    await author.agent
      .patch('/api/v1/profiles/me')
      .set('x-csrf-token', author.csrfToken)
      .send({ isPrivate: true })
      .expect(200);
    await viewer.agent
      .get(`/api/v1/posts?authorId=${author.userId}`)
      .expect(200)
      .expect({ posts: [], nextCursor: null });
  });
});
