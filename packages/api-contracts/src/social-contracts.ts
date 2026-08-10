import { z } from 'zod';

import { profileSchema } from './identity-contracts';

export const socialUserIdSchema = z.uuid();
export const socialConnectionStateSchema = z.enum(['following', 'requested']);
export const socialConnectionResponseSchema = z.object({ state: socialConnectionStateSchema });

export const followRequestSchema = z.object({
  requester: profileSchema,
  requestedAt: z.iso.datetime(),
});

export const followRequestsResponseSchema = z.object({
  requests: z.array(followRequestSchema),
});

export type SocialConnectionState = z.infer<typeof socialConnectionStateSchema>;
export type SocialConnectionResponse = z.infer<typeof socialConnectionResponseSchema>;
export type FollowRequest = z.infer<typeof followRequestSchema>;
export type FollowRequestsResponse = z.infer<typeof followRequestsResponseSchema>;
