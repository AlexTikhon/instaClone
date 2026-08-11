import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';

@Injectable()
export class StoryAccessPolicy {
  activeStory(): Prisma.Sql {
    return Prisma.sql`story."deletedAt" IS NULL AND story."expiresAt" > CURRENT_TIMESTAMP`;
  }

  visibleAuthor(viewerId: string): Prisma.Sql {
    return Prisma.sql`
      author."disabledAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks block
        WHERE (block."blockerId" = author.id AND block."blockedId" = ${viewerId}::uuid)
           OR (block."blockerId" = ${viewerId}::uuid AND block."blockedId" = author.id)
      )
      AND (
        story."authorId" = ${viewerId}::uuid
        OR profile."isPrivate" = FALSE
        OR EXISTS (
          SELECT 1 FROM follows follow_edge
          WHERE follow_edge."followerId" = ${viewerId}::uuid
            AND follow_edge."followingId" = story."authorId"
        )
      )
    `;
  }

  selfOrFollowed(viewerId: string): Prisma.Sql {
    return Prisma.sql`
      (
        story."authorId" = ${viewerId}::uuid
        OR EXISTS (
          SELECT 1 FROM follows follow_edge
          WHERE follow_edge."followerId" = ${viewerId}::uuid
            AND follow_edge."followingId" = story."authorId"
        )
      )
    `;
  }
}
