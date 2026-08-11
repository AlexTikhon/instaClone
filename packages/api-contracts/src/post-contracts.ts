import { z } from 'zod';

import { profileSchema } from './identity-contracts';
import { mediaResponseSchema } from './media-contracts';

export const createPostInputSchema = z.strictObject({
  caption: z.string().trim().max(2200).default(''),
  mediaAssetIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Media assets must be unique',
    }),
});

export const postIdSchema = z.uuid();

export const postMediaResponseSchema = mediaResponseSchema.extend({
  position: z.number().int().nonnegative(),
});

export const postResponseSchema = z.object({
  id: z.uuid(),
  author: profileSchema,
  caption: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  media: z.array(postMediaResponseSchema),
});

export const listPostsQuerySchema = z.strictObject({
  authorId: z.uuid(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(12),
});

export const paginatedPostsResponseSchema = z.object({
  posts: z.array(postResponseSchema),
  nextCursor: z.string().nullable(),
});

export type CreatePostInput = z.infer<typeof createPostInputSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
export type PaginatedPostsResponse = z.infer<typeof paginatedPostsResponseSchema>;
