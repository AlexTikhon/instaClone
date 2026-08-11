import { z } from 'zod';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const MEDIA_UPLOADED_EVENT = 'MEDIA_UPLOADED';
export const POST_CREATED_EVENT = 'POST_CREATED';

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

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type MediaUploadedEvent = z.infer<typeof mediaUploadedEventSchema>;
export type PostCreatedEvent = z.infer<typeof postCreatedEventSchema>;
