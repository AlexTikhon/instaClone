import { z } from 'zod';

import { profileSchema } from './identity-contracts';

export const socialUserIdSchema = z.uuid();
export const socialConnectionStateSchema = z.enum(['following', 'requested']);
export const socialConnectionResponseSchema = z.object({ state: socialConnectionStateSchema });

export const followRequestSchema = z.object({
  requester: profileSchema,
  requestedAt: z.iso.datetime(),
});

export const followRequestsQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const followRequestsResponseSchema = z.object({
  requests: z.array(followRequestSchema),
  nextCursor: z.string().nullable(),
});

export type SocialConnectionState = z.infer<typeof socialConnectionStateSchema>;
export type SocialConnectionResponse = z.infer<typeof socialConnectionResponseSchema>;
export type FollowRequest = z.infer<typeof followRequestSchema>;
export type FollowRequestsResponse = z.infer<typeof followRequestsResponseSchema>;
export type FollowRequestsQuery = z.infer<typeof followRequestsQuerySchema>;
