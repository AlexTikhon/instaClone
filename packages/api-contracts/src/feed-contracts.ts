import { z } from 'zod';

import { postResponseSchema } from './post-contracts';

export const feedQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const feedEngagementSchema = z.strictObject({
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  viewerHasLiked: z.boolean(),
  viewerHasSaved: z.boolean(),
});

export const feedItemSchema = z.strictObject({
  post: postResponseSchema,
  engagement: feedEngagementSchema,
});

export const feedResponseSchema = z.strictObject({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type FeedEngagement = z.infer<typeof feedEngagementSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
