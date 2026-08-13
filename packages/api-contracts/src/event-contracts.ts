import { z } from 'zod';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const MEDIA_UPLOADED_EVENT = 'MEDIA_UPLOADED';
export const VIDEO_UPLOADED_EVENT = 'VIDEO_UPLOADED';
export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const POST_CREATED_EVENT = 'POST_CREATED';
export const POST_LIKED_EVENT = 'POST_LIKED';
export const COMMENT_CREATED_EVENT = 'COMMENT_CREATED';
export const USER_FOLLOWED_EVENT = 'USER_FOLLOWED';
export const FOLLOW_REQUESTED_EVENT = 'FOLLOW_REQUESTED';
export const STORY_CREATED_EVENT = 'STORY_CREATED';
export const CONTENT_MODERATED_EVENT = 'CONTENT_MODERATED';
export const ACCOUNT_SUSPENDED_EVENT = 'ACCOUNT_SUSPENDED';

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

export const videoUploadedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(VIDEO_UPLOADED_EVENT),
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

export const storyCreatedPayloadSchema = z.strictObject({
  storyId: z.uuid(),
  authorId: z.uuid(),
  mediaAssetId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

export const storyCreatedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(STORY_CREATED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('Story'),
  payload: storyCreatedPayloadSchema,
});

export const contentModeratedPayloadSchema = z.strictObject({
  targetType: z.enum(['POST', 'COMMENT', 'STORY', 'REEL']),
  targetId: z.uuid(),
  action: z.literal('REMOVE_CONTENT'),
  occurredAt: z.iso.datetime(),
});

export const contentModeratedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(CONTENT_MODERATED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('ModerationCase'),
  payload: contentModeratedPayloadSchema,
});

export const accountSuspendedPayloadSchema = z.strictObject({
  targetType: z.literal('USER'),
  targetId: z.uuid(),
  action: z.literal('SUSPEND_ACCOUNT'),
  occurredAt: z.iso.datetime(),
});

export const accountSuspendedEventSchema = eventEnvelopeSchema.extend({
  eventName: z.literal(ACCOUNT_SUSPENDED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('ModerationCase'),
  payload: accountSuspendedPayloadSchema,
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type MediaUploadedEvent = z.infer<typeof mediaUploadedEventSchema>;
export type VideoUploadedEvent = z.infer<typeof videoUploadedEventSchema>;
export type PostCreatedEvent = z.infer<typeof postCreatedEventSchema>;
export type PostLikedEvent = z.infer<typeof postLikedEventSchema>;
export type CommentCreatedEvent = z.infer<typeof commentCreatedEventSchema>;
export type UserFollowedEvent = z.infer<typeof userFollowedEventSchema>;
export type FollowRequestedEvent = z.infer<typeof followRequestedEventSchema>;
export type StoryCreatedEvent = z.infer<typeof storyCreatedEventSchema>;
export type ContentModeratedEvent = z.infer<typeof contentModeratedEventSchema>;
export type AccountSuspendedEvent = z.infer<typeof accountSuspendedEventSchema>;
