import { z } from 'zod';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const MEDIA_UPLOADED_EVENT = 'MEDIA_UPLOADED';
export const POST_CREATED_EVENT = 'POST_CREATED';
export const POST_LIKED_EVENT = 'POST_LIKED';
export const COMMENT_CREATED_EVENT = 'COMMENT_CREATED';
export const USER_FOLLOWED_EVENT = 'USER_FOLLOWED';
export const FOLLOW_REQUESTED_EVENT = 'FOLLOW_REQUESTED';

export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventName: z.string().min(1).max(128),
  eventVersion: z.number().int().positive(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1).max(128),
  payload: z.unknown(),
});

export const mediaUploadedPayloadSchema = z.strictObject({
  mediaId: z.uuid(),
  ownerId: z.uuid(),
});

export const mediaUploadedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(MEDIA_UPLOADED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('MediaAsset'),
  payload: mediaUploadedPayloadSchema,
});

export const postCreatedPayloadSchema = z.strictObject({
  postId: z.uuid(),
  authorId: z.uuid(),
  mediaAssetIds: z.array(z.uuid()).min(1).max(10),
});

export const postCreatedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(POST_CREATED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('Post'),
  payload: postCreatedPayloadSchema,
});

export const postLikedPayloadSchema = z.strictObject({
  postId: z.uuid(),
  postAuthorId: z.uuid(),
  actorId: z.uuid(),
});

export const postLikedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(POST_LIKED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('PostLike'),
  payload: postLikedPayloadSchema,
});

export const commentCreatedPayloadSchema = z.strictObject({
  commentId: z.uuid(),
  postId: z.uuid(),
  postAuthorId: z.uuid(),
  authorId: z.uuid(),
});

export const commentCreatedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(COMMENT_CREATED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('Comment'),
  payload: commentCreatedPayloadSchema,
});

export const userFollowedPayloadSchema = z.strictObject({
  actorId: z.uuid(),
  targetUserId: z.uuid(),
});

export const userFollowedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(USER_FOLLOWED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('Follow'),
  payload: userFollowedPayloadSchema,
});

export const followRequestedPayloadSchema = z.strictObject({
  requesterId: z.uuid(),
  targetUserId: z.uuid(),
});

export const followRequestedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(FOLLOW_REQUESTED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('FollowRequest'),
  payload: followRequestedPayloadSchema,
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type MediaUploadedEvent = z.infer<typeof mediaUploadedEventSchema>;
export type PostCreatedEvent = z.infer<typeof postCreatedEventSchema>;
export type PostLikedEvent = z.infer<typeof postLikedEventSchema>;
export type CommentCreatedEvent = z.infer<typeof commentCreatedEventSchema>;
export type UserFollowedEvent = z.infer<typeof userFollowedEventSchema>;
export type FollowRequestedEvent = z.infer<typeof followRequestedEventSchema>;
