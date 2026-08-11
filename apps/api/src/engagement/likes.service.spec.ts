import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../infrastructure/database/prisma.service';
import type { PostAccessPolicy } from '../post-access/post-access-policy';
import { LikesService } from './likes.service';

describe('LikesService', () => {
  it('emits once when conflict-safe repeated likes insert one row', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'post' }]),
      postLike: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        count: vi.fn().mockResolvedValue(1),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const access = {
      requireInteractablePost: vi
        .fn()
        .mockResolvedValue({ id: 'post', authorId: crypto.randomUUID() }),
    } as unknown as PostAccessPolicy;
    const service = new LikesService(prisma, access);
    await service.like(crypto.randomUUID(), crypto.randomUUID(), 'request-1');
    await service.like(crypto.randomUUID(), crypto.randomUUID(), 'request-2');
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it('does not write when post authorization fails', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'post' }]),
      postLike: { updateMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
      outboxEvent: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const access = {
      requireInteractablePost: vi.fn().mockRejectedValue(new Error('hidden')),
    } as unknown as PostAccessPolicy;
    await expect(
      new LikesService(prisma, access).like(crypto.randomUUID(), crypto.randomUUID(), 'request'),
    ).rejects.toThrow('hidden');
    expect(transaction.postLike.createMany).not.toHaveBeenCalled();
    expect(transaction.postLike.updateMany).not.toHaveBeenCalled();
  });
});
