import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';

export interface StoryViewerCursor {
  viewedAt: Date;
  viewerId: string;
}

const cursorSchema = z.strictObject({
  viewedAt: z.iso.datetime(),
  viewerId: z.uuid(),
});

export const encodeStoryViewerCursor = (cursor: StoryViewerCursor): string =>
  Buffer.from(
    JSON.stringify({ viewedAt: cursor.viewedAt.toISOString(), viewerId: cursor.viewerId }),
  ).toString('base64url');

export const decodeStoryViewerCursor = (cursor: string): StoryViewerCursor => {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { viewedAt: new Date(parsed.viewedAt), viewerId: parsed.viewerId };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_STORY_CURSOR', 'Story cursor is invalid');
  }
};
