import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export interface PostCursor {
  createdAt: Date;
  id: string;
}

const schema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });

export const encodePostCursor = (cursor: PostCursor): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');

export const decodePostCursor = (value: string): PostCursor => {
  try {
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return { createdAt: new Date(decoded.createdAt), id: decoded.id };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
};
