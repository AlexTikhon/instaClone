import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const uuid = (namespace: number, value: number): string =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

const USER_COUNT = 2_000;
const CONTENT_USER_COUNT = 100;
const POSTS_PER_USER = 10;
const STORIES_PER_USER = 30;
const REELS_PER_USER = 5;
const CONVERSATION_COUNT = 500;
const MESSAGES_PER_CONVERSATION = 40;

const run = async () => {
  const userIds = Array.from({ length: USER_COUNT }, (_, index) => uuid(0x5ca1e001, index + 1));
  const previousUsers = await prisma.user.findMany({
    where: { email: { startsWith: 'scale-' } },
    select: { id: true },
  });
  const previousUserIds = previousUsers.map((user) => user.id);
  const previousCases = await prisma.moderationCase.findMany({
    where: {
      OR: [
        { userTargetId: { in: previousUserIds } },
        { postTarget: { is: { authorId: { in: previousUserIds } } } },
        { reports: { some: { reporterId: { in: previousUserIds } } } },
      ],
    },
    select: { id: true },
  });
  const previousCaseIds = previousCases.map((item) => item.id);
  if (previousCaseIds.length > 0) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_moderation_audit_cleanup', 'on', true)`;
      await transaction.moderationAuditLog.deleteMany({
        where: { caseId: { in: previousCaseIds } },
      });
      await transaction.moderationDecision.deleteMany({
        where: { caseId: { in: previousCaseIds } },
      });
      await transaction.report.deleteMany({ where: { caseId: { in: previousCaseIds } } });
      await transaction.moderationCase.deleteMany({ where: { id: { in: previousCaseIds } } });
    });
  }
  await prisma.post.deleteMany({ where: { authorId: { in: previousUserIds } } });
  await prisma.story.deleteMany({ where: { authorId: { in: previousUserIds } } });
  await prisma.reel.deleteMany({ where: { authorId: { in: previousUserIds } } });
  await prisma.mediaAsset.deleteMany({ where: { ownerId: { in: previousUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: previousUserIds } } });
  await prisma.user.createMany({
    data: userIds.map((id, index) => ({
      id,
      email: `scale-${index}@example.invalid`,
      role: index === 0 ? 'MODERATOR' : 'USER',
      disabledAt: index > 0 && index % 197 === 0 ? new Date('2026-01-01T00:00:00.000Z') : null,
    })),
  });
  await prisma.profile.createMany({
    data: userIds.map((userId, index) => ({
      userId,
      username: `scale_user_${index}`,
      displayName: `Scale User ${index}`,
      isPrivate: index > 0 && index % 11 === 0,
    })),
  });
  const contentUserIds = userIds.slice(0, CONTENT_USER_COUNT);
  await prisma.follow.createMany({
    data: contentUserIds.flatMap((followerId, index) =>
      Array.from({ length: 20 }, (_, offset) => ({
        followerId,
        followingId: contentUserIds[(index + offset + 1) % CONTENT_USER_COUNT]!,
      })),
    ),
    skipDuplicates: true,
  });

  const seededAt = new Date();
  const conversations = Array.from({ length: CONVERSATION_COUNT }, (_, index) => {
    const lastMessageAt = new Date(seededAt.getTime() - index * 60_000);
    return {
      id: uuid(0x5ca1e007, index + 1),
      lowerUserId: userIds[0]!,
      higherUserId: userIds[index + 1]!,
      lastSequence: BigInt(MESSAGES_PER_CONVERSATION),
      lowerLastReadSequence: BigInt(Math.max(0, MESSAGES_PER_CONVERSATION - (index % 11))),
      higherLastReadSequence: BigInt(MESSAGES_PER_CONVERSATION),
      lastMessageAt,
      createdAt: new Date(lastMessageAt.getTime() - MESSAGES_PER_CONVERSATION * 60_000),
    };
  });
  await prisma.conversation.createMany({ data: conversations });
  const messages = conversations.flatMap((conversation, conversationIndex) =>
    Array.from({ length: MESSAGES_PER_CONVERSATION }, (_, messageIndex) => {
      const sequence = messageIndex + 1;
      return {
        id: uuid(0x5ca1e008, conversationIndex * MESSAGES_PER_CONVERSATION + sequence),
        conversationId: conversation.id,
        senderId: sequence % 2 === 0 ? conversation.lowerUserId : conversation.higherUserId,
        sequence: BigInt(sequence),
        body: `Deterministic message ${sequence} in conversation ${conversationIndex + 1}`,
        clientMessageId: uuid(0x5ca1e009, conversationIndex * MESSAGES_PER_CONVERSATION + sequence),
        createdAt: new Date(
          conversation.lastMessageAt.getTime() - (MESSAGES_PER_CONVERSATION - sequence) * 60_000,
        ),
      };
    }),
  );
  await prisma.message.createMany({ data: messages });
  const posts = contentUserIds.flatMap((authorId, userIndex) =>
    Array.from({ length: POSTS_PER_USER }, (_, postIndex) => {
      const value = userIndex * POSTS_PER_USER + postIndex + 1;
      return {
        id: uuid(0x5ca1e002, value),
        authorId,
        caption: `Deterministic scale post ${value}`,
        createdAt: new Date(seededAt.getTime() - value * 60_000),
        deletedAt: value % 113 === 0 ? seededAt : null,
      };
    }),
  );
  const media: Prisma.MediaAssetCreateManyInput[] = posts.map((post, index) => ({
    id: uuid(0x5ca1e003, index + 1),
    ownerId: post.authorId,
    kind: 'IMAGE' as const,
    objectKey: `scale/${index + 1}/original`,
    thumbnailObjectKey: (index + 1) % 101 === 0 ? null : `scale/${index + 1}/thumb-640`,
    declaredMimeType: 'image/jpeg',
    declaredSizeBytes: 1024,
    verifiedSizeBytes: 1024,
    width: 640,
    height: 640,
    status: (index + 1) % 101 === 0 ? 'FAILED' : 'READY',
  }));
  await prisma.mediaAsset.createMany({ data: media });
  await prisma.post.createMany({ data: posts });
  await prisma.postMedia.createMany({
    data: posts.map((post, index) => ({
      postId: post.id,
      mediaAssetId: uuid(0x5ca1e003, index + 1),
      position: 0,
    })),
  });
  const likes = posts.flatMap((post, index) =>
    Array.from({ length: index % 18 }, (_, offset) => ({
      postId: post.id,
      userId: contentUserIds[(index + offset) % CONTENT_USER_COUNT]!,
    })),
  );
  await prisma.postLike.createMany({ data: likes, skipDuplicates: true });
  const comments = posts.flatMap((post, index) =>
    Array.from({ length: index % 7 }, (_, offset) => ({
      id: uuid(0x5ca1e004, index * 7 + offset + 1),
      postId: post.id,
      authorId: contentUserIds[(index + offset + 1) % CONTENT_USER_COUNT]!,
      body: `Scale comment ${offset + 1}`,
    })),
  );
  await prisma.comment.createMany({ data: comments });
  const stories = contentUserIds.flatMap((authorId, userIndex) =>
    Array.from({ length: STORIES_PER_USER }, (_, storyIndex) => {
      const value = userIndex * STORIES_PER_USER + storyIndex + 1;
      const active = storyIndex < STORIES_PER_USER / 2;
      const createdAt = new Date(
        seededAt.getTime() - (active ? storyIndex + 1 : storyIndex + 30) * 60 * 60 * 1_000,
      );
      return {
        id: uuid(0x5ca1e006, value),
        authorId,
        mediaAssetId: uuid(0x5ca1e005, value),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000),
        deletedAt: storyIndex % 14 === 0 ? seededAt : null,
      };
    }),
  );
  await prisma.mediaAsset.createMany({
    data: stories.map((item, index) => ({
      id: item.mediaAssetId,
      ownerId: item.authorId,
      kind: 'IMAGE' as const,
      objectKey: `scale/stories/${index + 1}/original`,
      thumbnailObjectKey: `scale/stories/${index + 1}/thumb-640`,
      declaredMimeType: 'image/jpeg',
      declaredSizeBytes: 1024,
      verifiedSizeBytes: 1024,
      width: 640,
      height: 800,
      status: 'READY' as const,
    })),
  });
  await prisma.story.createMany({ data: stories });
  await prisma.storyView.createMany({
    data: stories
      .filter((item) => item.expiresAt > seededAt && item.deletedAt === null)
      .flatMap((item, index) =>
        Array.from({ length: index % 2 === 0 ? 5 : 0 }, (_, offset) => ({
          storyId: item.id,
          viewerId: contentUserIds[(index + offset + 1) % CONTENT_USER_COUNT]!,
          viewedAt: new Date(item.createdAt.getTime() + (offset + 1) * 60_000),
        })),
      ),
    skipDuplicates: true,
  });
  const reels = contentUserIds.flatMap((authorId, userIndex) =>
    Array.from({ length: REELS_PER_USER }, (_, reelIndex) => {
      const value = userIndex * REELS_PER_USER + reelIndex + 1;
      return {
        id: uuid(0x5ca1e00e, value),
        authorId,
        mediaAssetId: uuid(0x5ca1e00f, value),
        caption: `Deterministic scale Reel ${value}`,
        createdAt: new Date(seededAt.getTime() - value * 90_000),
        deletedAt: value % 127 === 0 ? seededAt : null,
      };
    }),
  );
  await prisma.mediaAsset.createMany({
    data: reels.map((reel, index) => ({
      id: reel.mediaAssetId,
      ownerId: reel.authorId,
      kind: 'VIDEO' as const,
      objectKey: `scale/reels/${index + 1}/original`,
      thumbnailObjectKey: `scale/reels/${index + 1}/video/v1/seed/poster.webp`,
      declaredMimeType: 'video/mp4',
      declaredSizeBytes: 512_000,
      verifiedSizeBytes: 512_000,
      width: 720,
      height: 1_280,
      durationMs: 5_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 30,
      rotationDegrees: 0,
      processingVersion: 1,
      status: 'READY' as const,
    })),
  });
  await prisma.mediaVariant.createMany({
    data: reels.flatMap((reel, index) => {
      const prefix = `scale/reels/${index + 1}/video/v1/seed`;
      return [
        {
          mediaAssetId: reel.mediaAssetId,
          type: 'HLS_MASTER' as const,
          label: 'master',
          processingVersion: 1,
          objectKey: `${prefix}/master.m3u8`,
          mimeType: 'application/vnd.apple.mpegurl',
        },
        {
          mediaAssetId: reel.mediaAssetId,
          type: 'HLS_RENDITION' as const,
          label: '360',
          processingVersion: 1,
          objectKey: `${prefix}/360/index.m3u8`,
          mimeType: 'application/vnd.apple.mpegurl',
          width: 360,
          height: 640,
          bitrateKbps: 700,
        },
        {
          mediaAssetId: reel.mediaAssetId,
          type: 'POSTER' as const,
          label: 'poster',
          processingVersion: 1,
          objectKey: `${prefix}/poster.webp`,
          mimeType: 'image/webp',
          width: 360,
          height: 640,
        },
      ];
    }),
  });
  await prisma.reel.createMany({ data: reels });
  const openCaseId = uuid(0x5ca1e00a, 1);
  const closedCaseId = uuid(0x5ca1e00a, 2);
  await prisma.moderationCase.createMany({
    data: [
      {
        id: openCaseId,
        targetType: 'POST',
        targetId: posts[0]!.id,
        postTargetId: posts[0]!.id,
        status: 'OPEN',
      },
      {
        id: closedCaseId,
        targetType: 'POST',
        targetId: posts[1]!.id,
        postTargetId: posts[1]!.id,
        status: 'CLOSED',
        reviewerId: userIds[0],
        closedAt: seededAt,
      },
    ],
  });
  await prisma.report.createMany({
    data: [
      {
        id: uuid(0x5ca1e00b, 1),
        caseId: openCaseId,
        reporterId: userIds[2]!,
        targetType: 'POST',
        targetId: posts[0]!.id,
        postTargetId: posts[0]!.id,
        reason: 'SPAM',
        snapshotText: posts[0]!.caption,
        snapshotUsername: 'scale_user_0',
        snapshotOwnerId: posts[0]!.authorId,
        snapshotMediaAssetIds: [uuid(0x5ca1e003, 1)],
      },
      {
        id: uuid(0x5ca1e00b, 2),
        caseId: openCaseId,
        reporterId: userIds[3]!,
        targetType: 'POST',
        targetId: posts[0]!.id,
        postTargetId: posts[0]!.id,
        reason: 'SCAM',
        snapshotText: posts[0]!.caption,
        snapshotUsername: 'scale_user_0',
        snapshotOwnerId: posts[0]!.authorId,
        snapshotMediaAssetIds: [uuid(0x5ca1e003, 1)],
      },
      {
        id: uuid(0x5ca1e00b, 3),
        caseId: closedCaseId,
        reporterId: userIds[4]!,
        targetType: 'POST',
        targetId: posts[1]!.id,
        postTargetId: posts[1]!.id,
        reason: 'OTHER',
        status: 'CLOSED',
        snapshotText: posts[1]!.caption,
        snapshotUsername: 'scale_user_0',
        snapshotOwnerId: posts[1]!.authorId,
        snapshotMediaAssetIds: [uuid(0x5ca1e003, 2)],
        closedAt: seededAt,
      },
    ],
  });
  await prisma.moderationDecision.create({
    data: {
      id: uuid(0x5ca1e00c, 1),
      caseId: closedCaseId,
      actorUserId: userIds[0]!,
      action: 'NO_ACTION',
      internalNote: 'Deterministic scale-seed decision.',
      createdAt: seededAt,
    },
  });
  await prisma.moderationAuditLog.create({
    data: {
      id: uuid(0x5ca1e00d, 1),
      caseId: closedCaseId,
      actorUserId: userIds[0]!,
      action: 'NO_ACTION',
      targetType: 'POST',
      targetId: posts[1]!.id,
      createdAt: seededAt,
    },
  });
  process.stdout.write(
    `Seeded ${USER_COUNT} searchable users, ${posts.length} posts, ${stories.length} Stories, ${reels.length} Reels, ${conversations.length} conversations, ${messages.length} messages, 2,000 follows, ${likes.length} likes, ${comments.length} comments, 3 reports, and 2 moderation cases.\n`,
  );
};

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scale seed failed'}\n`);
    process.exitCode = 1;
  });
