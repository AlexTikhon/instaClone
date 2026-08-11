import { z } from 'zod';

import { mediaResponseSchema } from './media-contracts';

export const STORY_VISIBILITY_HOURS = 24;
export const MAX_ACTIVE_STORIES_PER_AUTHOR = 100;

export const createStoryInputSchema = z.strictObject({
  mediaAssetId: z.uuid(),
});

export const storyIdSchema = z.uuid();
export const storyAuthorIdSchema = z.uuid();

export const storyAuthorSchema = z.strictObject({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
});

export const storyResponseSchema = z.strictObject({
  id: z.uuid(),
  author: storyAuthorSchema,
  media: mediaResponseSchema.strict(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  viewerHasViewed: z.boolean(),
});

export const storyAuthorGroupSchema = z.strictObject({
  author: storyAuthorSchema,
  isViewer: z.boolean(),
  hasUnseenStories: z.boolean(),
  storyCount: z.number().int().positive(),
  latestStoryAt: z.iso.datetime(),
});

export const storyTrayResponseSchema = z.strictObject({
  groups: z.array(storyAuthorGroupSchema),
});

export const storySequenceResponseSchema = z.strictObject({
  author: storyAuthorSchema,
  stories: z.array(storyResponseSchema),
});

export const storyViewResponseSchema = z.strictObject({
  storyId: z.uuid(),
  recorded: z.boolean(),
  viewedAt: z.iso.datetime().nullable(),
});

export const storyViewerResponseSchema = z.strictObject({
  user: storyAuthorSchema,
  viewedAt: z.iso.datetime(),
});

export const storyViewersQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const storyViewersResponseSchema = z.strictObject({
  viewers: z.array(storyViewerResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type CreateStoryInput = z.infer<typeof createStoryInputSchema>;
export type StoryAuthor = z.infer<typeof storyAuthorSchema>;
export type StoryResponse = z.infer<typeof storyResponseSchema>;
export type StoryAuthorGroup = z.infer<typeof storyAuthorGroupSchema>;
export type StoryTrayResponse = z.infer<typeof storyTrayResponseSchema>;
export type StorySequenceResponse = z.infer<typeof storySequenceResponseSchema>;
export type StoryViewResponse = z.infer<typeof storyViewResponseSchema>;
export type StoryViewerResponse = z.infer<typeof storyViewerResponseSchema>;
export type StoryViewersQuery = z.infer<typeof storyViewersQuerySchema>;
export type StoryViewersResponse = z.infer<typeof storyViewersResponseSchema>;
