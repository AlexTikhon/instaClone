import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';

export interface ConversationCursor {
  snapshotAt: Date;
  activityAt: Date;
  conversationId: string;
}

const schema = z.strictObject({
  version: z.literal(1),
  snapshotAt: z.iso.datetime(),
  activityAt: z.iso.datetime(),
  conversationId: z.uuid(),
});

export const encodeConversationCursor = (cursor: ConversationCursor): string =>
  Buffer.from(
    JSON.stringify({
      version: 1,
      snapshotAt: cursor.snapshotAt.toISOString(),
      activityAt: cursor.activityAt.toISOString(),
      conversationId: cursor.conversationId,
    }),
  ).toString('base64url');

export const decodeConversationCursor = (value: string): ConversationCursor => {
  try {
    if (value.length > 1024) throw new Error('Cursor is too long');
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    const snapshotAt = new Date(decoded.snapshotAt);
    const activityAt = new Date(decoded.activityAt);
    if (activityAt > snapshotAt) throw new Error('Activity cannot be newer than snapshot');
    return { snapshotAt, activityAt, conversationId: decoded.conversationId };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_CONVERSATION_CURSOR',
      'Conversation cursor is invalid',
    );
  }
};
