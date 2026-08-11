import { z } from 'zod';

import { feedItemSchema } from './feed-contracts';

export const MIN_SEARCH_QUERY_LENGTH = 2;
export const MAX_SEARCH_QUERY_LENGTH = 60;

const normalizedSearchQuerySchema = z
  .string()
  .trim()
  .min(MIN_SEARCH_QUERY_LENGTH)
  .max(MAX_SEARCH_QUERY_LENGTH)
  .transform((value) => value.replace(/\s+/g, ' ').toLocaleLowerCase('en-US'));

export const searchUsersQuerySchema = z.strictObject({
  q: normalizedSearchQuerySchema,
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(20),
});

export const searchRelationshipStateSchema = z.enum(['self', 'none', 'following', 'requested']);

export const searchUserResultSchema = z.strictObject({
  userId: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  isPrivate: z.boolean(),
  relationship: searchRelationshipStateSchema,
});

export const searchUsersResponseSchema = z.strictObject({
  users: z.array(searchUserResultSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const exploreQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(18),
});

export const exploreItemSchema = feedItemSchema;

export const exploreResponseSchema = z.strictObject({
  items: z.array(exploreItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  snapshotAt: z.iso.datetime(),
});

export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
export type SearchRelationshipState = z.infer<typeof searchRelationshipStateSchema>;
export type SearchUserResult = z.infer<typeof searchUserResultSchema>;
export type SearchUsersResponse = z.infer<typeof searchUsersResponseSchema>;
export type ExploreQuery = z.infer<typeof exploreQuerySchema>;
export type ExploreItem = z.infer<typeof exploreItemSchema>;
export type ExploreResponse = z.infer<typeof exploreResponseSchema>;
