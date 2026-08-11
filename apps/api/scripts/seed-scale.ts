import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const uuid = (namespace: number, value: number): string =>
  `${namespace.toString(16).padStart(8, '0')}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;

const USER_COUNT = 100;
const POSTS_PER_USER = 10;
const STORIES_PER_USER = 30;

const run = async () => {
  const userIds = Array.from({ length: USER_COUNT }, (_, index) => uuid(0x5ca1e001, index + 1));
  await prisma.user.deleteMany({ where: { email: { startsWith: 'scale-' } } });
  await prisma.user.createMany({
    data: userIds.map((id, index) => ({ id, email: `scale-${index}@example.invalid` })),
  });
  await prisma.profile.createMany({
    data: userIds.map((userId, index) => ({
      userId,
      username: `scale_user_${index}`,
      displayName: `Scale User ${index}`,
    })),
  });
  await prisma.follow.createMany({
    data: userIds.flatMap((followerId, index) =>
      Array.from({ length: 20 }, (_, offset) => ({
        followerId,
        followingId: userIds[(index + offset + 1) % USER_COUNT]!,
      })),
    ),
    skipDuplicates: true,
  });

  const posts = userIds.flatMap((authorId, userIndex) =>
    Array.from({ length: POSTS_PER_USER }, (_, postIndex) => {
      const value = userIndex * POSTS_PER_USER + postIndex + 1;
      return {
        id: uuid(0x5ca1e002, value),
        authorId,
        caption: `Deterministic scale post ${value}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, value)),
      };
    }),
  );
  const media = posts.map((post, index) => ({
    id: uuid(0x5ca1e003, index + 1),
    ownerId: post.authorId,
    kind: 'IMAGE' as const,
    objectKey: `scale/${index + 1}/original`,
    thumbnailObjectKey: `scale/${index + 1}/thumb-640`,
    declaredMimeType: 'image/jpeg',
    declaredSizeBytes: 1024,
    verifiedSizeBytes: 1024,
    width: 640,
    height: 640,
    status: 'READY' as const,
  }));
  await prisma.mediaAsset.createMany({ data: media });
  await prisma.post.createMany({ data: posts });
  await prisma.postMedia.createMany({
    data: posts.map((post, index) => ({
      postId: post.id,
      mediaAssetId: media[index]!.id,
      position: 0,
    })),
  });
  await prisma.postLike.createMany({
    data: posts.flatMap((post, index) =>
      Array.from({ length: 5 }, (_, offset) => ({
        postId: post.id,
        userId: userIds[(index + offset) % USER_COUNT]!,
      })),
    ),
    skipDuplicates: true,
  });
  await prisma.comment.createMany({
    data: posts.flatMap((post, index) =>
      Array.from({ length: 2 }, (_, offset) => ({
        id: uuid(0x5ca1e004, index * 2 + offset + 1),
        postId: post.id,
        authorId: userIds[(index + offset + 1) % USER_COUNT]!,
        body: `Scale comment ${offset + 1}`,
      })),
    ),
  });
  const seededAt = new Date();
  const stories = userIds.flatMap((authorId, userIndex) =>
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
          viewerId: userIds[(index + offset + 1) % USER_COUNT]!,
          viewedAt: new Date(item.createdAt.getTime() + (offset + 1) * 60_000),
        })),
      ),
    skipDuplicates: true,
  });
  process.stdout.write(
    `Seeded ${USER_COUNT} users, ${posts.length} posts, ${stories.length} Stories, 2,000 follows, 5,000 likes, and 2,000 comments.\n`,
  );
};

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scale seed failed'}\n`);
    process.exitCode = 1;
  });
