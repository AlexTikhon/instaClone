import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export interface ReelCursor {
  createdAt: Date;
  id: string;
}

const schema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });

export const encodeReelCursor = (cursor: ReelCursor): string =>
  Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');

export const decodeReelCursor = (value: string): ReelCursor => {
  try {
    const decoded = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return { createdAt: new Date(decoded.createdAt), id: decoded.id };
  } catch {
    throw new BadRequestException('Invalid Reel pagination cursor');
  }
};
