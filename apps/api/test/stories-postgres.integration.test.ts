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

describe.runIf(postgresEnabled)('Stories PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

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
      .useValue({
        ping: () => Promise.resolve(),
        createDownloadUrl: (key: string) => Promise.resolve(`https://media.example/${key}`),
        createUploadUrl: () => Promise.resolve('http://storage.local/upload'),
        headObject: () => Promise.resolve({ contentLength: 1, contentType: 'image/jpeg' }),
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
      where: { email: { startsWith: 'phase6-' } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const stories = await prisma.story.findMany({
      where: { authorId: { in: userIds } },
      select: { id: true },
    });
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateId: { in: stories.map((story) => story.id) } },
          { eventName: 'STORY_CREATED' },
        ],
      },
    });
    await prisma.story.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => app.close());

  const register = async (name: string): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email: `phase6-${name}-${randomUUID()}@example.com`,
        password: 'phase-six-secure-password',
        username: `${name}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        displayName: name,
      })
      .expect(201);
    const userId = (response.body as { user: { id: string } }).user.id;
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return { agent, csrfToken, userId };
  };

  const mediaAsset = async (ownerId: string, status: 'READY' | 'UPLOADED' = 'READY') => {
    const id = randomUUID();
    return prisma.mediaAsset.create({
      data: {
        id,
        ownerId,
        kind: 'IMAGE',
        objectKey: `users/${ownerId}/media/${id}/original`,
        thumbnailObjectKey: status === 'READY' ? `users/${ownerId}/media/${id}/thumb-640` : null,
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 1024,
        verifiedSizeBytes: 1024,
        width: 640,
        height: 800,
        status,
      },
    });
  };

  const story = async (
    authorId: string,
    options: { createdAt?: Date; expiresAt?: Date; deletedAt?: Date } = {},
  ) => {
    const media = await mediaAsset(authorId);
    const createdAt = options.createdAt ?? new Date(Date.now() - 60_000);
    return prisma.story.create({
      data: {
        authorId,
        mediaAssetId: media.id,
        createdAt,
        expiresAt: options.expiresAt ?? new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000),
        deletedAt: options.deletedAt,
      },
    });
  };

  it('creates from owned READY image media with server time and an atomic durable event', async () => {
    const [author, other] = await Promise.all([
      register('create_author'),
      register('create_other'),
    ]);
    const ready = await mediaAsset(author.userId);
    const pending = await mediaAsset(author.userId, 'UPLOADED');
    const foreign = await mediaAsset(other.userId);

    await author.agent
      .post('/api/v1/stories')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: foreign.id })
      .expect(403)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'STORY_MEDIA_NOT_OWNED' } }),
      );
    await author.agent
      .post('/api/v1/stories')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: pending.id })
      .expect(409)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'STORY_MEDIA_NOT_READY' } }),
      );
    await author.agent
      .post('/api/v1/stories')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: ready.id, authorId: other.userId })
      .expect(400);

    const before = Date.now();
    const response = await author.agent
      .post('/api/v1/stories')
      .set('x-csrf-token', author.csrfToken)
      .set('x-request-id', 'phase6-story-create')
      .send({ mediaAssetId: ready.id })
      .expect(201);
    const created = response.body as { id: string; createdAt: string; expiresAt: string };
    expect(Date.parse(created.createdAt)).toBeGreaterThanOrEqual(before - 1_000);
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(
      24 * 60 * 60 * 1_000,
    );
    expect(await prisma.story.findUnique({ where: { id: created.id } })).toMatchObject({
      authorId: author.userId,
      mediaAssetId: ready.id,
    });
    expect(
      await prisma.outboxEvent.findFirst({ where: { aggregateId: created.id } }),
    ).toMatchObject({
      eventName: 'STORY_CREATED',
      correlationId: 'phase6-story-create',
    });
  });

  it('builds an unseen-first self/following tray with every visibility exclusion', async () => {
    const [viewer, followed, privateFollowed, stranger, blocked] = await Promise.all([
      register('tray_viewer'),
      register('tray_followed'),
      register('tray_private'),
      register('tray_stranger'),
      register('tray_blocked'),
    ]);
    await prisma.profile.updateMany({
      where: { userId: { in: [privateFollowed.userId, stranger.userId] } },
      data: { isPrivate: true },
    });
    await prisma.follow.createMany({
      data: [followed, privateFollowed, blocked].map((actor) => ({
        followerId: viewer.userId,
        followingId: actor.userId,
      })),
    });
    await prisma.block.create({ data: { blockerId: blocked.userId, blockedId: viewer.userId } });

    const base = Date.now() - 5 * 60_000;
    const own = await story(viewer.userId, { createdAt: new Date(base + 1_000) });
    const followedStory = await story(followed.userId, { createdAt: new Date(base + 2_000) });
    const privateStory = await story(privateFollowed.userId, { createdAt: new Date(base + 3_000) });
    const strangerStory = await story(stranger.userId, { createdAt: new Date(base + 4_000) });
    await story(blocked.userId, { createdAt: new Date(base + 5_000) });
    await story(followed.userId, {
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1_000),
    });
    await story(followed.userId, { deletedAt: new Date() });
    await prisma.storyView.create({
      data: { storyId: privateStory.id, viewerId: viewer.userId },
    });

    const tray = await viewer.agent.get('/api/v1/stories').expect(200);
    const groups = (
      tray.body as { groups: { author: { id: string }; hasUnseenStories: boolean }[] }
    ).groups;
    expect(groups.map((group) => group.author.id)).toEqual([
      followed.userId,
      privateFollowed.userId,
      viewer.userId,
    ]);
    expect(groups.map((group) => group.hasUnseenStories)).toEqual([true, false, false]);
    expect(
      (await viewer.agent.get(`/api/v1/stories/users/${followed.userId}`).expect(200)).body,
    ).toMatchObject({
      stories: [{ id: followedStory.id }],
    });
    await viewer.agent.get(`/api/v1/stories/${strangerStory.id}`).expect(404);
    await viewer.agent.get(`/api/v1/stories/${own.id}`).expect(200);
  });

  it('records one first-view row under retries and authorizes retained viewer pages', async () => {
    const [author, viewer, secondViewer, intruder] = await Promise.all([
      register('views_author'),
      register('views_viewer'),
      register('views_second'),
      register('views_intruder'),
    ]);
    await prisma.follow.createMany({
      data: [viewer, secondViewer].map((actor) => ({
        followerId: actor.userId,
        followingId: author.userId,
      })),
    });
    const target = await story(author.userId);

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        viewer.agent.put(`/api/v1/stories/${target.id}/view`).set('x-csrf-token', viewer.csrfToken),
      ),
    );
    expect(attempts.every((attempt) => attempt.status === 200)).toBe(true);
    const viewBodies = attempts.map((attempt) => attempt.body as { viewedAt: string });
    const firstViewedAt = viewBodies[0]?.viewedAt;
    expect(viewBodies.every((body) => body.viewedAt === firstViewedAt)).toBe(true);
    expect(
      await prisma.storyView.count({ where: { storyId: target.id, viewerId: viewer.userId } }),
    ).toBe(1);

    await author.agent
      .put(`/api/v1/stories/${target.id}/view`)
      .set('x-csrf-token', author.csrfToken)
      .expect(200)
      .expect({ storyId: target.id, recorded: false, viewedAt: null });
    expect(await prisma.storyView.count({ where: { storyId: target.id } })).toBe(1);
    await secondViewer.agent
      .put(`/api/v1/stories/${target.id}/view`)
      .set('x-csrf-token', secondViewer.csrfToken)
      .expect(200);
    await prisma.storyView.update({
      where: { storyId_viewerId: { storyId: target.id, viewerId: viewer.userId } },
      data: { viewedAt: new Date('2026-08-11T12:00:00.000Z') },
    });
    await prisma.storyView.update({
      where: { storyId_viewerId: { storyId: target.id, viewerId: secondViewer.userId } },
      data: { viewedAt: new Date('2026-08-11T11:00:00.000Z') },
    });

    await intruder.agent.get(`/api/v1/stories/${target.id}/viewers`).expect(404);
    const firstPage = await author.agent
      .get(`/api/v1/stories/${target.id}/viewers?limit=1`)
      .expect(200);
    const firstPageBody = firstPage.body as { nextCursor: string | null };
    expect(firstPage.body).toMatchObject({
      viewers: [{ user: { id: viewer.userId } }],
      hasMore: true,
    });
    const secondPage = await author.agent
      .get(`/api/v1/stories/${target.id}/viewers?limit=1&cursor=${firstPageBody.nextCursor ?? ''}`)
      .expect(200);
    expect(secondPage.body).toMatchObject({
      viewers: [{ user: { id: secondViewer.userId } }],
      hasMore: false,
    });
    await author.agent.get(`/api/v1/stories/${target.id}/viewers?cursor=bad`).expect(400);

    await prisma.story.update({
      where: { id: target.id },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 60 * 60 * 1_000),
      },
    });
    await viewer.agent.get(`/api/v1/stories/${target.id}`).expect(404);
    await viewer.agent
      .put(`/api/v1/stories/${target.id}/view`)
      .set('x-csrf-token', viewer.csrfToken)
      .expect(404);
    await author.agent.get(`/api/v1/stories/${target.id}/viewers`).expect(200);
  });

  it('soft-deletes only an owned Story and makes it immediately unavailable', async () => {
    const [author, viewer] = await Promise.all([
      register('delete_author'),
      register('delete_viewer'),
    ]);
    const target = await story(author.userId);
    await viewer.agent
      .delete(`/api/v1/stories/${target.id}`)
      .set('x-csrf-token', viewer.csrfToken)
      .expect(404);
    await author.agent
      .delete(`/api/v1/stories/${target.id}`)
      .set('x-csrf-token', author.csrfToken)
      .expect(204);
    expect(
      (await prisma.story.findUniqueOrThrow({ where: { id: target.id } })).deletedAt,
    ).not.toBeNull();
    await author.agent.get(`/api/v1/stories/${target.id}`).expect(404);
    await viewer.agent
      .put(`/api/v1/stories/${target.id}/view`)
      .set('x-csrf-token', viewer.csrfToken)
      .expect(404);
    await author.agent.get(`/api/v1/stories/${target.id}/viewers`).expect(200);
  });
});
