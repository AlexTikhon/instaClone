import { z } from 'zod';

import { profileSchema } from './identity-contracts';

export const MAX_COMMENT_LENGTH = 1000;

export const likeResponseSchema = z.strictObject({
  liked: z.boolean(),
  likeCount: z.number().int().nonnegative(),
});

export const saveResponseSchema = z.strictObject({ saved: z.boolean() });

export const createCommentInputSchema = z.strictObject({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});

export const commentResponseSchema = z.strictObject({
  id: z.uuid(),
  postId: z.uuid(),
  author: profileSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  viewerCanDelete: z.boolean(),
});

export const commentsQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const commentsResponseSchema = z.strictObject({
  comments: z.array(commentResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type LikeResponse = z.infer<typeof likeResponseSchema>;
export type SaveResponse = z.infer<typeof saveResponseSchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type CommentResponse = z.infer<typeof commentResponseSchema>;
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;
export type CommentsResponse = z.infer<typeof commentsResponseSchema>;
