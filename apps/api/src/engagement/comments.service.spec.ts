import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../infrastructure/database/prisma.service';
import { ApiError } from '../platform/errors/api-error';
import type { PostAccessPolicy } from '../post-access/post-access-policy';
import { CommentsService } from './comments.service';

describe('CommentsService deletion', () => {
  it('rejects deletion by a different author without mutating the row', async () => {
    const updateMany = vi.fn();
    const prisma = {
      comment: {
        findFirst: vi.fn().mockResolvedValue({ authorId: crypto.randomUUID() }),
        updateMany,
      },
    } as unknown as PrismaService;
    const service = new CommentsService(prisma, {} as PostAccessPolicy);
    let thrown: unknown;
    try {
      await service.delete(crypto.randomUUID(), crypto.randomUUID());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).getResponse()).toMatchObject({ code: 'COMMENT_NOT_OWNED' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
