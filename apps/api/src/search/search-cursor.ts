import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../platform/errors/api-error';
import type { ExploreCursor, SearchUserCursor } from './search.types';

const searchCursorSchema = z.strictObject({
  query: z.string().min(2).max(60),
  rank: z.number().int().min(1).max(6),
  normalizedUsername: z.string().min(1).max(30),
  userId: z.uuid(),
});

const exploreCursorSchema = z.strictObject({
  snapshotAt: z.iso.datetime(),
  score: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  postId: z.uuid(),
});

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export const encodeSearchCursor = (cursor: SearchUserCursor): string => encode(cursor);

export const decodeSearchCursor = (value: string, query: string): SearchUserCursor => {
  try {
    if (value.length > 512) throw new Error('Cursor is too long');
    const cursor = searchCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (cursor.query !== query) throw new Error('Cursor query does not match');
    return cursor;
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_SEARCH_CURSOR', 'Search cursor is invalid');
  }
};

export const encodeExploreCursor = (cursor: ExploreCursor): string =>
  encode({
    snapshotAt: cursor.snapshotAt.toISOString(),
    score: cursor.score,
    createdAt: cursor.createdAt.toISOString(),
    postId: cursor.postId,
  });

export const decodeExploreCursor = (value: string): ExploreCursor => {
  try {
    if (value.length > 512) throw new Error('Cursor is too long');
    const cursor = exploreCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return {
      snapshotAt: new Date(cursor.snapshotAt),
      score: cursor.score,
      createdAt: new Date(cursor.createdAt),
      postId: cursor.postId,
    };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_EXPLORE_CURSOR',
      'Explore cursor is invalid',
    );
  }
};
