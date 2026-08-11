import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../infrastructure/database/prisma.service';
import type { PostAccessPolicy } from '../post-access/post-access-policy';
import { SavedPostsService } from './saved-posts.service';

describe('SavedPostsService', () => {
  it('uses conflict-safe save and retry-safe unsave operations', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'post' }]),
      savedPost: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const access = {
      requireInteractablePost: vi.fn().mockResolvedValue({ id: 'post', authorId: 'author' }),
    } as unknown as PostAccessPolicy;
    const service = new SavedPostsService(prisma, access);
    const viewerId = crypto.randomUUID();
    const postId = crypto.randomUUID();
    await expect(service.save(viewerId, postId)).resolves.toEqual({ saved: true });
    await expect(service.unsave(viewerId, postId)).resolves.toEqual({ saved: false });
    expect(transaction.savedPost.createMany).toHaveBeenCalledWith({
      data: [{ userId: viewerId, postId }],
      skipDuplicates: true,
    });
    expect(transaction.savedPost.deleteMany).toHaveBeenCalledTimes(1);
  });
});
