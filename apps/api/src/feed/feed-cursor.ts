import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';

export interface FeedCursor {
  createdAt: Date;
  postId: string;
}

const schema = z.strictObject({ createdAt: z.iso.datetime(), postId: z.uuid() });

export const encodeFeedCursor = (cursor: FeedCursor): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), postId: cursor.postId }),
  ).toString('base64url');

export const decodeFeedCursor = (value: string): FeedCursor => {
  try {
    if (value.length > 512) throw new Error('Cursor is too long');
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return { createdAt: new Date(decoded.createdAt), postId: decoded.postId };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_FEED_CURSOR', 'Feed cursor is invalid');
  }
};
