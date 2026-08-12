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

describe.runIf(postgresEnabled)('Moderation PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: () => Promise.resolve(),
        sendPasswordReset: () => Promise.resolve(),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve(), consumeRateLimit: () => Promise.resolve(20) })
      .overrideProvider(ObjectStorageService)
      .useValue({
        ping: () => Promise.resolve(),
        createDownloadUrl: (key: string) => Promise.resolve(`https://media.example/${key}`),
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
      where: { email: { startsWith: `phase9-${runId}-` } },
      select: {
        id: true,
        posts: { select: { id: true } },
        stories: { select: { id: true } },
      },
    });
    const userIds = users.map((user) => user.id);
    const postIds = users.flatMap((user) => user.posts.map((post) => post.id));
    const caseRows = await prisma.moderationCase.findMany({
      where: {
        OR: [
          { targetId: { in: [...userIds, ...postIds] } },
          { reports: { some: { reporterId: { in: userIds } } } },
        ],
      },
      select: { id: true },
    });
    const caseIds = caseRows.map((item) => item.id);
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_moderation_audit_cleanup', 'on', true)`;
      await transaction.outboxEvent.deleteMany({ where: { aggregateId: { in: caseIds } } });
      await transaction.moderationAuditLog.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.moderationDecision.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.report.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
      await transaction.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.post.deleteMany({ where: { authorId: { in: userIds } } });
      await transaction.story.deleteMany({ where: { authorId: { in: userIds } } });
      await transaction.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await app.close();
  });

  const register = async (
    name: string,
    role: 'USER' | 'MODERATOR' | 'ADMIN' = 'USER',
  ): Promise<TestActor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const email = `phase9-${runId}-${name}-${randomUUID()}@example.com`;
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email,
        password: 'phase-nine-secure-password',
        username: `${name}_${runId}`,
        displayName: name,
      })
      .expect(201);
    const userId = (response.body as { user: { id: string } }).user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), role },
    });
    return { agent, csrfToken, email, userId };
  };

  const createPost = async (authorId: string, caption: string) => {
    const mediaAssetId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: mediaAssetId,
        ownerId: authorId,
        kind: 'IMAGE',
        objectKey: `phase9/${runId}/${mediaAssetId}/original`,
        thumbnailObjectKey: `phase9/${runId}/${mediaAssetId}/thumbnail`,
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 100,
        verifiedSizeBytes: 100,
        width: 100,
        height: 100,
        status: 'READY',
      },
    });
    return prisma.post.create({
      data: {
        authorId,
        caption,
        media: { create: { mediaAssetId, position: 0 } },
      },
    });
  };

  const report = (
    actor: TestActor,
    targetType: 'USER' | 'POST' | 'COMMENT' | 'STORY',
    targetId: string,
    reason = 'SPAM',
  ) =>
    actor.agent
      .post('/api/v1/reports')
      .set('x-csrf-token', actor.csrfToken)
      .send({ targetType, targetId, reason });

  it('groups concurrent reports into one active case and prevents active duplicates', async () => {
    const [author, firstReporter, secondReporter, firstModerator, secondModerator] =
      await Promise.all([
        register('concurrent_author'),
        register('concurrent_first'),
        register('concurrent_second'),
        register('concurrent_mod_one', 'MODERATOR'),
        register('concurrent_mod_two', 'MODERATOR'),
      ]);
    const post = await createPost(author.userId, 'Concurrency evidence');

    const [first, second] = await Promise.all([
      report(firstReporter, 'POST', post.id),
      report(secondReporter, 'POST', post.id),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await prisma.report.count({ where: { targetType: 'POST', targetId: post.id } })).toBe(2);
    expect(
      await prisma.moderationCase.count({
        where: { targetType: 'POST', targetId: post.id, status: { in: ['OPEN', 'IN_REVIEW'] } },
      }),
    ).toBe(1);

    await report(firstReporter, 'POST', post.id)
      .expect(409)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'DUPLICATE_ACTIVE_REPORT' } }),
      );
    await report(author, 'POST', post.id).expect(404);

    await prisma.block.create({
      data: { blockerId: author.userId, blockedId: firstReporter.userId },
    });
    const hidden = await createPost(author.userId, 'Hidden evidence');
    await report(firstReporter, 'POST', hidden.id)
      .expect(404)
      .expect((response) =>
        expect(response.body).toMatchObject({ error: { code: 'REPORT_TARGET_NOT_FOUND' } }),
      );

    const moderationCase = await prisma.moderationCase.findFirstOrThrow({
      where: { targetType: 'POST', targetId: post.id, status: 'OPEN' },
    });
    await firstReporter.agent.get(`/api/v1/moderation/cases/${moderationCase.id}`).expect(403);
    const resolutions = await Promise.all([
      firstModerator.agent
        .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
        .set('x-csrf-token', firstModerator.csrfToken)
        .send({ action: 'NO_ACTION' }),
      secondModerator.agent
        .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
        .set('x-csrf-token', secondModerator.csrfToken)
        .send({ action: 'REMOVE_CONTENT' }),
    ]);
    expect(resolutions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.moderationDecision.count({ where: { caseId: moderationCase.id } })).toBe(1);
    expect(await prisma.moderationAuditLog.count({ where: { caseId: moderationCase.id } })).toBe(1);
    const audit = await prisma.moderationAuditLog.findFirstOrThrow({
      where: { caseId: moderationCase.id },
    });
    await expect(
      prisma.moderationAuditLog.update({
        where: { id: audit.id },
        data: { targetId: randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it('removes posts, comments, and Stories through real access paths with immutable audit', async () => {
    const [author, viewer, moderator] = await Promise.all([
      register('enforce_author'),
      register('enforce_viewer'),
      register('enforce_moderator', 'MODERATOR'),
    ]);
    await prisma.follow.create({ data: { followerId: viewer.userId, followingId: author.userId } });
    const post = await createPost(author.userId, 'Remove this post');
    const comment = await prisma.comment.create({
      data: { postId: post.id, authorId: author.userId, body: 'Remove this comment' },
    });
    const storyMediaId = randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: storyMediaId,
        ownerId: author.userId,
        kind: 'IMAGE',
        objectKey: `phase9/${runId}/${storyMediaId}/original`,
        thumbnailObjectKey: `phase9/${runId}/${storyMediaId}/thumbnail`,
        declaredMimeType: 'image/jpeg',
        declaredSizeBytes: 100,
        verifiedSizeBytes: 100,
        width: 100,
        height: 100,
        status: 'READY',
      },
    });
    const story = await prisma.story.create({
      data: {
        authorId: author.userId,
        mediaAssetId: storyMediaId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });

    for (const [targetType, targetId] of [
      ['COMMENT', comment.id],
      ['STORY', story.id],
    ] as const) {
      await report(viewer, targetType, targetId).expect(201);
      const moderationCase = await prisma.moderationCase.findFirstOrThrow({
        where: { targetType, targetId, status: 'OPEN' },
      });
      await moderator.agent
        .post(`/api/v1/moderation/cases/${moderationCase.id}/start-review`)
        .set('x-csrf-token', moderator.csrfToken)
        .expect(200);
      await moderator.agent
        .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
        .set('x-csrf-token', moderator.csrfToken)
        .send({ action: 'REMOVE_CONTENT', internalNote: 'Synthetic test decision' })
        .expect(200);
      expect(await prisma.moderationAuditLog.count({ where: { caseId: moderationCase.id } })).toBe(
        2,
      );
    }

    const comments = await viewer.agent.get(`/api/v1/posts/${post.id}/comments`).expect(200);
    expect((comments.body as { comments: { id: string }[] }).comments).not.toContainEqual(
      expect.objectContaining({ id: comment.id }),
    );
    await viewer.agent.get(`/api/v1/stories/${story.id}`).expect(404);
    await viewer.agent
      .put(`/api/v1/stories/${story.id}/view`)
      .set('x-csrf-token', viewer.csrfToken)
      .expect(404);

    await report(viewer, 'POST', post.id).expect(201);
    const postCase = await prisma.moderationCase.findFirstOrThrow({
      where: { targetType: 'POST', targetId: post.id, status: 'OPEN' },
    });
    await moderator.agent
      .post(`/api/v1/moderation/cases/${postCase.id}/resolve`)
      .set('x-csrf-token', moderator.csrfToken)
      .send({ action: 'REMOVE_CONTENT' })
      .expect(200);
    await viewer.agent.get(`/api/v1/posts/${post.id}`).expect(404);
    const feed = await viewer.agent.get('/api/v1/feed').expect(200);
    expect(
      (feed.body as { items: { post: { id: string } }[] }).items.map((item) => item.post.id),
    ).not.toContain(post.id);
    const profilePosts = await viewer.agent
      .get(`/api/v1/posts?authorId=${author.userId}`)
      .expect(200);
    expect((profilePosts.body as { posts: { id: string }[] }).posts).toEqual([]);
    const explore = await viewer.agent.get('/api/v1/explore').expect(200);
    expect(
      (explore.body as { items: { post: { id: string } }[] }).items.map((item) => item.post.id),
    ).not.toContain(post.id);
  });

  it('limits suspension to admins and invalidates existing sessions immediately', async () => {
    const [target, reporter, moderator, admin] = await Promise.all([
      register('suspend_target'),
      register('suspend_reporter'),
      register('suspend_moderator', 'MODERATOR'),
      register('suspend_admin', 'ADMIN'),
    ]);
    await prisma.follow.create({
      data: { followerId: reporter.userId, followingId: target.userId },
    });
    const targetPost = await createPost(target.userId, 'Hidden after account suspension');
    const [lowerUserId, higherUserId] = [target.userId, reporter.userId].sort();
    const messageCreatedAt = new Date();
    const conversation = await prisma.conversation.create({
      data: {
        lowerUserId: lowerUserId!,
        higherUserId: higherUserId!,
        lastSequence: 1n,
        lastMessageAt: messageCreatedAt,
        messages: {
          create: {
            senderId: target.userId,
            sequence: 1n,
            body: 'Retained conversation history',
            clientMessageId: randomUUID(),
            createdAt: messageCreatedAt,
          },
        },
      },
    });
    await report(reporter, 'USER', target.userId, 'IMPERSONATION').expect(201);
    const moderationCase = await prisma.moderationCase.findFirstOrThrow({
      where: { targetType: 'USER', targetId: target.userId, status: 'OPEN' },
    });
    await moderator.agent
      .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
      .set('x-csrf-token', moderator.csrfToken)
      .send({ action: 'SUSPEND_ACCOUNT' })
      .expect(403);
    expect(await prisma.moderationDecision.count({ where: { caseId: moderationCase.id } })).toBe(0);
    expect(await prisma.moderationAuditLog.count({ where: { caseId: moderationCase.id } })).toBe(0);

    await admin.agent
      .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ action: 'SUSPEND_ACCOUNT' })
      .expect(200);
    await target.agent.get('/api/v1/auth/me').expect(401);
    await target.agent
      .post('/api/v1/posts')
      .set('x-csrf-token', target.csrfToken)
      .send({})
      .expect(401);
    await target.agent
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set('x-csrf-token', target.csrfToken)
      .send({ text: 'Should not send', clientMessageId: randomUUID() })
      .expect(401);
    const loginAgent = request.agent(server);
    const loginCsrf = await loginAgent.get('/api/v1/auth/csrf').expect(200);
    await loginAgent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', (loginCsrf.body as { csrfToken: string }).csrfToken)
      .send({ email: target.email, password: 'phase-nine-secure-password' })
      .expect(401);
    await reporter.agent
      .get(`/api/v1/profiles/${encodeURIComponent(`suspend_target_${runId}`)}`)
      .expect(404);
    const search = await reporter.agent
      .get(`/api/v1/search/users?q=suspend_target_${runId}`)
      .expect(200);
    expect((search.body as { users: { userId: string }[] }).users).toEqual([]);
    const feed = await reporter.agent.get('/api/v1/feed').expect(200);
    expect(
      (feed.body as { items: { post: { id: string } }[] }).items.map((item) => item.post.id),
    ).not.toContain(targetPost.id);
    const explore = await reporter.agent.get('/api/v1/explore').expect(200);
    expect(
      (explore.body as { items: { post: { id: string } }[] }).items.map((item) => item.post.id),
    ).not.toContain(targetPost.id);
    await reporter.agent
      .post('/api/v1/conversations')
      .set('x-csrf-token', reporter.csrfToken)
      .send({ participantUserId: target.userId })
      .expect(404);
    const history = await reporter.agent
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .expect(200);
    expect((history.body as { items: { text: string }[] }).items).toContainEqual(
      expect.objectContaining({ text: 'Retained conversation history' }),
    );
    expect(await prisma.moderationDecision.count({ where: { caseId: moderationCase.id } })).toBe(1);
    expect(await prisma.moderationAuditLog.count({ where: { caseId: moderationCase.id } })).toBe(1);
  });
});
