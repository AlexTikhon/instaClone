import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';
import type { ModerationCaseCursor } from './moderation.types';

const schema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });

export const encodeModerationCaseCursor = (cursor: ModerationCaseCursor): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');

export const decodeModerationCaseCursor = (cursor: string): ModerationCaseCursor => {
  try {
    const parsed = schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_MODERATION_CURSOR',
      'Moderation cursor is invalid',
    );
  }
};
