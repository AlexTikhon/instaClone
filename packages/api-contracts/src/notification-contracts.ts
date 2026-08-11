import { z } from 'zod';

export const NOTIFICATION_CREATED_MESSAGE = 'NOTIFICATION_CREATED';
export const NOTIFICATION_REALTIME_CHANNEL = 'instaclone:notifications:v1';

export const notificationTypeSchema = z.enum(['LIKE', 'COMMENT', 'FOLLOW', 'FOLLOW_REQUEST']);

export const notificationActorSchema = z.strictObject({
  id: z.uuid().nullable(),
  username: z.string().min(1).max(30),
  displayName: z.string().min(1).max(60),
  isAvailable: z.boolean(),
});

export const notificationTargetSchema = z.strictObject({
  postId: z.uuid().nullable(),
  commentId: z.uuid().nullable(),
  contentAvailable: z.boolean().nullable(),
});

export const notificationResponseSchema = z.strictObject({
  id: z.uuid(),
  type: notificationTypeSchema,
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  actor: notificationActorSchema,
  target: notificationTargetSchema,
});

export const notificationsQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const notificationsResponseSchema = z.strictObject({
  items: z.array(notificationResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
});

export const markNotificationReadInputSchema = z.strictObject({});
export const markNotificationReadResponseSchema = notificationResponseSchema;

export const markAllNotificationsReadInputSchema = z.strictObject({});
export const markAllNotificationsReadResponseSchema = z.strictObject({
  readAt: z.iso.datetime(),
  updatedCount: z.number().int().nonnegative(),
});

export const realtimeNotificationPayloadSchema = z.strictObject({
  notification: notificationResponseSchema,
});

export const realtimeNotificationMessageSchema = z.strictObject({
  event: z.literal(NOTIFICATION_CREATED_MESSAGE),
  data: realtimeNotificationPayloadSchema,
});

export const notificationRealtimeEnvelopeSchema = z.strictObject({
  recipientId: z.uuid(),
  payload: realtimeNotificationPayloadSchema,
});

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type NotificationActor = z.infer<typeof notificationActorSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadInputSchema>;
export type MarkNotificationReadResponse = z.infer<typeof markNotificationReadResponseSchema>;
export type MarkAllNotificationsReadInput = z.infer<typeof markAllNotificationsReadInputSchema>;
export type MarkAllNotificationsReadResponse = z.infer<
  typeof markAllNotificationsReadResponseSchema
>;
export type RealtimeNotificationPayload = z.infer<typeof realtimeNotificationPayloadSchema>;
export type RealtimeNotificationMessage = z.infer<typeof realtimeNotificationMessageSchema>;
export type NotificationRealtimeEnvelope = z.infer<typeof notificationRealtimeEnvelopeSchema>;
