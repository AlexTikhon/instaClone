import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';

export interface CommentCursor {
  createdAt: Date;
  id: string;
}

const schema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });

export const encodeCommentCursor = (cursor: CommentCursor): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');

export const decodeCommentCursor = (value: string): CommentCursor => {
  try {
    if (value.length > 512) throw new Error('Cursor is too long');
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return { createdAt: new Date(decoded.createdAt), id: decoded.id };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_COMMENT_CURSOR',
      'Comment cursor is invalid',
    );
  }
};
