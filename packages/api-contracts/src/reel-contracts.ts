import { z } from 'zod';

import { profileSchema } from './identity-contracts';

export const createReelInputSchema = z.strictObject({
  mediaAssetId: z.uuid(),
  caption: z.string().trim().max(2200).default(''),
});

export const reelIdSchema = z.uuid();

export const videoPlaybackSchema = z.strictObject({
  type: z.literal('HLS'),
  url: z.string().startsWith('/api/v1/'),
  posterUrl: z.string().startsWith('/api/v1/'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive(),
});

export const reelResponseSchema = z.strictObject({
  id: z.uuid(),
  author: profileSchema,
  caption: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  playback: videoPlaybackSchema,
});

export const reelsQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const reelsResponseSchema = z.strictObject({
  reels: z.array(reelResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type CreateReelInput = z.infer<typeof createReelInputSchema>;
export type ReelResponse = z.infer<typeof reelResponseSchema>;
export type ReelsQuery = z.infer<typeof reelsQuerySchema>;
export type ReelsResponse = z.infer<typeof reelsResponseSchema>;
export type VideoPlayback = z.infer<typeof videoPlaybackSchema>;
