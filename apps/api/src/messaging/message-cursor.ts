import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';

export interface MessageCursor {
  conversationId: string;
  beforeSequence: bigint;
}

const schema = z.strictObject({
  version: z.literal(1),
  conversationId: z.uuid(),
  beforeSequence: z.string().regex(/^\d+$/),
});

export const encodeMessageCursor = (cursor: MessageCursor): string =>
  Buffer.from(
    JSON.stringify({
      version: 1,
      conversationId: cursor.conversationId,
      beforeSequence: cursor.beforeSequence.toString(),
    }),
  ).toString('base64url');

export const decodeMessageCursor = (value: string, conversationId: string): MessageCursor => {
  try {
    if (value.length > 512) throw new Error('Cursor is too long');
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    const beforeSequence = BigInt(decoded.beforeSequence);
    if (decoded.conversationId !== conversationId || beforeSequence <= 0n) {
      throw new Error('Cursor does not belong to this conversation');
    }
    return { conversationId, beforeSequence };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_MESSAGE_CURSOR',
      'Message cursor is invalid',
    );
  }
};
