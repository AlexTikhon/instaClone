import { Injectable } from '@nestjs/common';

import type { SaveResponse } from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { PostAccessPolicy } from '../post-access/post-access-policy';

@Injectable()
export class SavedPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PostAccessPolicy,
  ) {}

  save(viewerId: string, postId: string): Promise<SaveResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await this.access.requireInteractablePost(transaction, viewerId, postId);
      await transaction.savedPost.createMany({
        data: [{ userId: viewerId, postId }],
        skipDuplicates: true,
      });
      return { saved: true };
    });
  }

  unsave(viewerId: string, postId: string): Promise<SaveResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await this.access.requireInteractablePost(transaction, viewerId, postId);
      await transaction.savedPost.deleteMany({ where: { userId: viewerId, postId } });
      return { saved: false };
    });
  }
}
