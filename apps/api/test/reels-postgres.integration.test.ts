import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MAX_VIDEO_UPLOAD_BYTES } from '@instaclone/api-contracts';

import { AppModule } from '../src/app.module';
import { AuthEmailService } from '../src/auth/auth-email.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { ObjectStorageService } from '../src/infrastructure/object-storage/object-storage.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { configureApplication } from '../src/platform/bootstrap';

interface Actor {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  userId: string;
}

const enabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';

describe.runIf(enabled)('Reels PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  const storedObjects = new Map<string, { contentLength: number; contentType: string }>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthEmailService)
      .useValue({
        sendEmailVerification: () => Promise.resolve(),
        sendPasswordReset: () => Promise.resolve(),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve(), consumeRateLimit: () => Promise.resolve(50) })
      .overrideProvider(ObjectStorageService)
      .useValue({
        ping: () => Promise.resolve(),
        createDownloadUrl: () => Promise.resolve('https://unused'),
        createUploadUrl: ({ objectKey }: { objectKey: string }) =>
          Promise.resolve(`http://storage.local/${objectKey}`),
        headObject: (objectKey: string) => {
          const object = storedObjects.get(objectKey);
          return object
            ? Promise.resolve(object)
            : Promise.reject(
                Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } }),
              );
        },
        getObjectStream: (key: string) => {
          const body = key.endsWith('.m3u8') ? Buffer.from('#EXTM3U\n') : Buffer.from([1, 2, 3]);
          return Promise.resolve({
            body: Readable.from([body]),
            contentLength: body.byteLength,
            contentType: key.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
          });
        },
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
      where: { email: { startsWith: `phase10-${runId}-` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const cases = await prisma.moderationCase.findMany({
      where: {
        OR: [
          { reelTarget: { is: { authorId: { in: userIds } } } },
          { reports: { some: { reporterId: { in: userIds } } } },
        ],
      },
      select: { id: true },
    });
    const caseIds = cases.map((item) => item.id);
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_moderation_audit_cleanup', 'on', true)`;
      await transaction.outboxEvent.deleteMany({ where: { aggregateId: { in: caseIds } } });
      await transaction.moderationAuditLog.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.moderationDecision.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.report.deleteMany({ where: { caseId: { in: caseIds } } });
      await transaction.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
      await transaction.reel.deleteMany({ where: { authorId: { in: userIds } } });
      await transaction.mediaAsset.deleteMany({ where: { ownerId: { in: userIds } } });
      await transaction.authAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
      await transaction.user.deleteMany({ where: { id: { in: userIds } } });
    });
    await app.close();
  });

  const register = async (name: string, role: 'USER' | 'MODERATOR' = 'USER'): Promise<Actor> => {
    const agent = request.agent(server);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
    const response = await agent
      .post('/api/v1/auth/register')
      .set('x-csrf-token', csrfToken)
      .send({
        email: `phase10-${runId}-${name}@example.com`,
        password: 'phase-ten-secure-password',
        username: `p10_${runId}_${name}`,
        displayName: name,
      })
      .expect(201);
    const userId = (response.body as { user: { id: string } }).user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), role },
    });
    return { agent, csrfToken, userId };
  };

  const media = async (
    ownerId: string,
    state: 'READY' | 'PROCESSING' | 'FAILED' = 'READY',
    kind: 'VIDEO' | 'IMAGE' = 'VIDEO',
  ) => {
    const id = randomUUID();
    const attempt = randomUUID();
    const prefix = `users/${ownerId}/media/${id}/video/v1/attempts/${attempt}`;
    return prisma.mediaAsset.create({
      data: {
        id,
        ownerId,
        kind,
        objectKey: `users/${ownerId}/media/${id}/original`,
        declaredMimeType: kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg',
        declaredSizeBytes: 100,
        verifiedSizeBytes: 100,
        status: state,
        ...(state === 'READY' && kind === 'VIDEO'
          ? {
              width: 720,
              height: 1280,
              durationMs: 2_000,
              videoCodec: 'h264',
              audioCodec: 'aac',
              frameRate: 24,
              rotationDegrees: 0,
              processingVersion: 1,
              thumbnailObjectKey: `${prefix}/poster.webp`,
              variants: {
                create: [
                  {
                    type: 'HLS_MASTER',
                    label: 'master',
                    processingVersion: 1,
                    objectKey: `${prefix}/master.m3u8`,
                    mimeType: 'application/vnd.apple.mpegurl',
                  },
                  {
                    type: 'HLS_RENDITION',
                    label: '360',
                    processingVersion: 1,
                    objectKey: `${prefix}/360/index.m3u8`,
                    mimeType: 'application/vnd.apple.mpegurl',
                    width: 360,
                    height: 640,
                    bitrateKbps: 700,
                  },
                  {
                    type: 'POSTER',
                    label: 'poster',
                    processingVersion: 1,
                    objectKey: `${prefix}/poster.webp`,
                    mimeType: 'image/webp',
                    width: 360,
                    height: 640,
                  },
                ],
              },
            }
          : {}),
      },
    });
  };

  it('authorizes bounded video uploads and atomically emits VIDEO_UPLOADED after verification', async () => {
    const author = await register('upload_author');
    await author.agent
      .post('/api/v1/media/uploads')
      .set('x-csrf-token', author.csrfToken)
      .send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: MAX_VIDEO_UPLOAD_BYTES + 1 })
      .expect(400);
    const initialization = await author.agent
      .post('/api/v1/media/uploads')
      .set('x-csrf-token', author.csrfToken)
      .send({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 1_024 })
      .expect(201);
    const mediaId = (initialization.body as { media: { id: string } }).media.id;
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
    storedObjects.set(asset.objectKey, { contentLength: 1_024, contentType: 'video/mp4' });
    await author.agent
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('x-csrf-token', author.csrfToken)
      .send({})
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({ kind: 'VIDEO', status: 'UPLOADED' }),
      );
    expect(await prisma.outboxEvent.findFirst({ where: { aggregateId: mediaId } })).toMatchObject({
      eventName: 'VIDEO_UPLOADED',
      aggregateType: 'MediaAsset',
      payload: { mediaId, ownerId: author.userId },
    });
  });

  it('requires owned READY video, enforces unique consumption, and pages chronologically', async () => {
    const [author, other] = await Promise.all([register('author'), register('other')]);
    const ready = await media(author.userId);
    const processing = await media(author.userId, 'PROCESSING');
    const image = await media(author.userId, 'READY', 'IMAGE');
    const foreign = await media(other.userId);
    for (const [assetId, status] of [
      [processing.id, 409],
      [image.id, 400],
      [foreign.id, 403],
    ] as const) {
      await author.agent
        .post('/api/v1/reels')
        .set('x-csrf-token', author.csrfToken)
        .send({ mediaAssetId: assetId, caption: 'invalid' })
        .expect(status);
    }
    const created = await author.agent
      .post('/api/v1/reels')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: ready.id, caption: ' first reel ' })
      .expect(201);
    expect(created.body).toMatchObject({
      caption: 'first reel',
      playback: { type: 'HLS', width: 720, height: 1280, durationMs: 2000 },
    });
    expect(JSON.stringify(created.body)).not.toContain('users/');
    await author.agent
      .post('/api/v1/reels')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: ready.id, caption: 'duplicate' })
      .expect(409);

    const secondMedia = await media(author.userId);
    await author.agent
      .post('/api/v1/reels')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: secondMedia.id, caption: 'second reel' })
      .expect(201);
    const firstPage = await other.agent.get('/api/v1/reels?limit=1').expect(200);
    const firstBody = firstPage.body as {
      reels: { id: string }[];
      hasMore: boolean;
      nextCursor: string;
    };
    expect(firstBody.reels).toHaveLength(1);
    expect(firstBody.hasMore).toBe(true);
    const secondPage = await other.agent
      .get(`/api/v1/reels?limit=1&cursor=${firstBody.nextCursor}`)
      .expect(200);
    const secondBody = secondPage.body as { reels: { id: string }[] };
    expect(secondBody.reels[0]?.id).not.toBe(firstBody.reels[0]?.id);
  });

  it('applies private, follow, block, account, deletion, and Reel moderation visibility', async () => {
    const [author, viewer, moderator] = await Promise.all([
      register('privacy_author'),
      register('privacy_viewer'),
      register('privacy_mod', 'MODERATOR'),
    ]);
    await prisma.profile.update({ where: { userId: author.userId }, data: { isPrivate: true } });
    const video = await media(author.userId);
    const created = await author.agent
      .post('/api/v1/reels')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: video.id, caption: 'private reel' })
      .expect(201);
    const reelId = (created.body as { id: string }).id;
    await viewer.agent.get(`/api/v1/reels/${reelId}`).expect(404);
    await viewer.agent.get(`/api/v1/reels/${reelId}/playback/master.m3u8`).expect(404);
    await prisma.follow.create({ data: { followerId: viewer.userId, followingId: author.userId } });
    await viewer.agent.get(`/api/v1/reels/${reelId}`).expect(200);
    await viewer.agent
      .get(`/api/v1/reels/${reelId}/playback/master.m3u8`)
      .expect('content-type', /application\/vnd\.apple\.mpegurl/)
      .expect(200);
    await viewer.agent
      .get(`/api/v1/reels/${reelId}/playback/360/segment-00000.ts`)
      .expect('content-type', /video\/mp2t/)
      .expect(200);
    await prisma.block.create({ data: { blockerId: author.userId, blockedId: viewer.userId } });
    await viewer.agent.get(`/api/v1/reels/${reelId}`).expect(404);
    await prisma.block.delete({
      where: { blockerId_blockedId: { blockerId: author.userId, blockedId: viewer.userId } },
    });

    await viewer.agent
      .post('/api/v1/reports')
      .set('x-csrf-token', viewer.csrfToken)
      .send({ targetType: 'REEL', targetId: reelId, reason: 'SPAM' })
      .expect(201);
    const moderationCase = await prisma.moderationCase.findFirstOrThrow({
      where: { targetType: 'REEL', targetId: reelId },
    });
    expect(
      (await prisma.report.findFirstOrThrow({ where: { caseId: moderationCase.id } })).reelTargetId,
    ).toBe(reelId);
    await moderator.agent
      .post(`/api/v1/moderation/cases/${moderationCase.id}/resolve`)
      .set('x-csrf-token', moderator.csrfToken)
      .send({ action: 'REMOVE_CONTENT' })
      .expect(200);
    await viewer.agent.get(`/api/v1/reels/${reelId}`).expect(404);

    const deletableMedia = await media(author.userId);
    const deletable = await author.agent
      .post('/api/v1/reels')
      .set('x-csrf-token', author.csrfToken)
      .send({ mediaAssetId: deletableMedia.id })
      .expect(201);
    const deletableId = (deletable.body as { id: string }).id;
    await author.agent
      .delete(`/api/v1/reels/${deletableId}`)
      .set('x-csrf-token', author.csrfToken)
      .expect(204);
    await author.agent.get(`/api/v1/reels/${deletableId}`).expect(404);
  });
});
