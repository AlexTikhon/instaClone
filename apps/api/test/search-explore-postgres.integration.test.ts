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

describe.runIf(postgresEnabled)('Search and Explore PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const runId = randomUUID().replaceAll('-', '').slice(0, 7);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: () => Promise.resolve(),
        sendPasswordReset: () => Promise.resolve(),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve(), consumeRateLimit: () => Promise.resolve(120) })
      .overrideProvider(ObjectStorageService)
      .useValue({
        ping: () => Promise.resolve(),
        createDownloadUrl: (objectKey: string) =>
          Promise.resolve(`https://media.example/${objectKey}?signed=true`),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: `phase7-${runId}-` } },
      select: { id: true, posts: { select: { id: true } } },
    });
    const userIds = users.map((user) => user.id);
    const postIds = users.flatMap((user) => user.posts.map((post) => post.id));
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...userIds, ...postIds] } },
    });
    await prisma.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.post.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  const register = async (
    name: string,
    username = `${name}_${runId}`,
    displayName = name,
  ): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email: `phase7-${runId}-${name}-${randomUUID()}@example.com`,
        password: 'phase-seven-secure-password',
        username,
        displayName,
      })
      .expect(201);
    return {
      agent,
      csrfToken,
      userId: (response.body as { user: { id: string } }).user.id,
    };
  };

  const createPost = async (
    authorId: string,
    caption: string,
    createdAt: Date,
    status: 'READY' | 'FAILED' = 'READY',
  ) => {
    const mediaId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: mediaId,
        ownerId: authorId,
        kind: 'IMAGE',
        objectKey: `phase7/${runId}/${mediaId}/original`,
        thumbnailObjectKey: status === 'READY' ? `phase7/${runId}/${mediaId}/thumb` : null,
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 1024,
        verifiedSizeBytes: status === 'READY' ? 1024 : null,
        width: status === 'READY' ? 640 : null,
        height: status === 'READY' ? 640 : null,
        status,
      },
    });
    return prisma.post.create({
      data: {
        authorId,
        caption,
        createdAt,
        media: { create: { mediaAssetId: mediaId, position: 0 } },
      },
    });
  };

  it('ranks literal normalized user matches, pages deterministically, and hydrates relationships', async () => {
    const viewer = await register('searchviewer');
    const query = `nova${runId}`;
    const exact = await register('exact', query, 'Different Name');
    await register('prefix', `${query}_tail`, 'Different Name');
    const exactDisplay = await register('displayexact', `tier3_${runId}`, query.toUpperCase());
    await register('displayprefix', `tier4_${runId}`, `${query} Person`);
    await register('usernamecontains', `the_${query}_x`, 'Different Name');
    await register('displaycontains', `tier6_${runId}`, `Person ${query} End`);
    const blockedByViewer = await register('blockedone', `x_${query}_blocked`, 'Blocked');
    const blocksViewer = await register('blockedtwo', `x_${query}_reverse`, 'Blocked reverse');
    const disabled = await register('disabled', `x_${query}_disabled`, 'Disabled');

    await Promise.all([
      prisma.follow.create({
        data: { followerId: viewer.userId, followingId: exact.userId },
      }),
      prisma.followRequest.create({
        data: { requesterId: viewer.userId, targetId: exactDisplay.userId },
      }),
      prisma.block.create({
        data: { blockerId: viewer.userId, blockedId: blockedByViewer.userId },
      }),
      prisma.block.create({
        data: { blockerId: blocksViewer.userId, blockedId: viewer.userId },
      }),
      prisma.user.update({ where: { id: disabled.userId }, data: { disabledAt: new Date() } }),
    ]);

    const seen: { username: string; relationship: string }[] = [];
    let cursor: string | null = null;
    do {
      const search = new URLSearchParams({ q: `  ${query.toUpperCase()}  `, limit: '2' });
      if (cursor) search.set('cursor', cursor);
      const response = await viewer.agent
        .get(`/api/v1/search/users?${search.toString()}`)
        .expect(200);
      const body = response.body as {
        users: { username: string; relationship: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.users);
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen.map((user) => user.username)).toEqual([
      query,
      `${query}_tail`,
      `tier3_${runId}`,
      `tier4_${runId}`,
      `the_${query}_x`,
      `tier6_${runId}`,
    ]);
    expect(seen[0]?.relationship).toBe('following');
    expect(seen[2]?.relationship).toBe('requested');
    expect(new Set(seen.map((user) => user.username)).size).toBe(6);

    await viewer.agent.get('/api/v1/search/users').expect(400);
    await viewer.agent.get('/api/v1/search/users?q=a').expect(400);
    await viewer.agent.get(`/api/v1/search/users?q=${query}&limit=26`).expect(400);
    await viewer.agent
      .get(`/api/v1/search/users?q=different&cursor=${Buffer.from('{}').toString('base64url')}`)
      .expect(400)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'INVALID_SEARCH_CURSOR' } }),
      );
  });

  it('ranks a stable Explore snapshot without leaking excluded posts or duplicating pages', async () => {
    const [
      viewer,
      engagedAuthor,
      freshAuthor,
      steadyAuthor,
      acceptedPrivate,
      hiddenPrivate,
      blocked,
      reverseBlock,
    ] = await Promise.all([
      register('exploreviewer'),
      register('engagedauthor'),
      register('freshauthor'),
      register('steadyauthor'),
      register('acceptedprivate'),
      register('hiddenprivate'),
      register('blockedauthor'),
      register('reverseblock'),
    ]);
    await Promise.all([
      prisma.profile.update({
        where: { userId: acceptedPrivate.userId },
        data: { isPrivate: true },
      }),
      prisma.profile.update({ where: { userId: hiddenPrivate.userId }, data: { isPrivate: true } }),
      prisma.follow.create({
        data: { followerId: viewer.userId, followingId: acceptedPrivate.userId },
      }),
      prisma.block.create({ data: { blockerId: viewer.userId, blockedId: blocked.userId } }),
      prisma.block.create({ data: { blockerId: reverseBlock.userId, blockedId: viewer.userId } }),
    ]);

    const now = Date.now();
    const engaged = await createPost(
      engagedAuthor.userId,
      'engaged-visible',
      new Date(now - 2 * 60 * 60 * 1000),
    );
    const accepted = await createPost(
      acceptedPrivate.userId,
      'accepted-private-visible',
      new Date(now - 60 * 60 * 1000),
    );
    const fresh = await createPost(freshAuthor.userId, 'fresh-visible', new Date(now - 60_000));
    const steady = await createPost(
      steadyAuthor.userId,
      'steady-visible',
      new Date(now - 3 * 60 * 60 * 1000),
    );
    const deleted = await createPost(engagedAuthor.userId, 'deleted', new Date(now - 30_000));
    await prisma.post.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await Promise.all([
      createPost(viewer.userId, 'own', new Date(now)),
      createPost(hiddenPrivate.userId, 'hidden-private', new Date(now)),
      createPost(blocked.userId, 'blocked', new Date(now)),
      createPost(reverseBlock.userId, 'reverse-blocked', new Date(now)),
      createPost(freshAuthor.userId, 'failed-media', new Date(now), 'FAILED'),
    ]);
    await prisma.postLike.create({ data: { userId: viewer.userId, postId: engaged.id } });
    await prisma.comment.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        authorId: viewer.userId,
        postId: engaged.id,
        body: `Ranking comment ${index}`,
      })),
    });
    await prisma.comment.create({
      data: {
        authorId: viewer.userId,
        postId: accepted.id,
        body: 'Private ranking comment',
      },
    });

    const first = await viewer.agent.get('/api/v1/explore?limit=2').expect(200);
    const firstBody = first.body as {
      items: { post: { id: string } }[];
      nextCursor: string;
      hasMore: boolean;
      snapshotAt: string;
    };
    expect(firstBody.items.map((item) => item.post.id)).toEqual([engaged.id, accepted.id]);
    expect(firstBody.hasMore).toBe(true);
    const afterSnapshot = new Date(Date.parse(firstBody.snapshotAt) + 1_000);
    await prisma.postLike.update({
      where: { userId_postId: { userId: viewer.userId, postId: engaged.id } },
      data: { deletedAt: afterSnapshot },
    });
    await prisma.comment.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        id: randomUUID(),
        authorId: viewer.userId,
        postId: steady.id,
        body: `After-snapshot comment ${index}`,
        createdAt: afterSnapshot,
      })),
    });
    const second = await viewer.agent
      .get(`/api/v1/explore?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`)
      .expect(200);
    const secondBody = second.body as {
      items: { post: { id: string } }[];
      snapshotAt: string;
    };
    expect(secondBody.items.map((item) => item.post.id)).toEqual([fresh.id, steady.id]);
    expect(secondBody.snapshotAt).toBe(firstBody.snapshotAt);
    expect(
      new Set([...firstBody.items, ...secondBody.items].map((item) => item.post.id)).size,
    ).toBe(4);
    await viewer.agent
      .get('/api/v1/explore?cursor=malformed')
      .expect(400)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'INVALID_EXPLORE_CURSOR' } }),
      );
  });
});
