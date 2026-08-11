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
  process.stdout.write(
    `Seeded ${USER_COUNT} users, ${posts.length} posts, 2,000 follows, 5,000 likes, and 2,000 comments.\n`,
  );
};

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scale seed failed'}\n`);
    process.exitCode = 1;
  });
