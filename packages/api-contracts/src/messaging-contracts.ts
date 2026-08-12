import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 4_000;
export const MESSAGE_CREATED_EVENT = 'MESSAGE_CREATED';
export const MESSAGE_CREATED_MESSAGE = 'MESSAGE_CREATED';
export const APPLICATION_REALTIME_CHANNEL = 'instaclone:realtime:v1';

export const conversationIdSchema = z.uuid();
export const clientMessageIdSchema = z.uuid();

export const createConversationInputSchema = z.strictObject({
  participantUserId: z.uuid(),
});

export const conversationPeerSchema = z.strictObject({
  userId: z.uuid(),
  username: z.string().min(1).max(30),
  displayName: z.string().min(1).max(60),
  isAvailable: z.boolean(),
});

export const messageSchema = z.strictObject({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  clientMessageId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const conversationSummarySchema = z.strictObject({
  id: z.uuid(),
  peer: conversationPeerSchema,
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  lastMessage: messageSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  blocked: z.boolean(),
});

export const conversationListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const conversationListResponseSchema = z.strictObject({
  items: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const messagesQuerySchema = z.strictObject({
  before: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const messagesResponseSchema = z.strictObject({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const sendMessageInputSchema = z.strictObject({
  text: z
    .string()
    .max(MAX_MESSAGE_LENGTH)
    .refine((value) => value.trim().length > 0, 'Message text cannot be blank'),
  clientMessageId: clientMessageIdSchema,
});

export const markConversationReadInputSchema = z.strictObject({
  messageId: z.uuid(),
});

export const markConversationReadResponseSchema = z.strictObject({
  conversationId: z.uuid(),
  lastReadSequence: z.number().int().nonnegative().safe(),
  unreadCount: z.number().int().nonnegative(),
});

export const messageCreatedPayloadSchema = z.strictObject({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  sequence: z.number().int().positive().safe(),
  occurredAt: z.iso.datetime(),
});

export const messageCreatedEventSchema = z.object({
  eventId: z.uuid(),
  eventName: z.literal(MESSAGE_CREATED_EVENT),
  eventVersion: z.literal(1),
  aggregateType: z.literal('Message'),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1).max(128),
  payload: messageCreatedPayloadSchema,
});

export const realtimeMessageCreatedSchema = z.strictObject({
  event: z.literal(MESSAGE_CREATED_MESSAGE),
  data: messageCreatedPayloadSchema.omit({ recipientId: true }),
});

export type CreateConversationInput = z.infer<typeof createConversationInputSchema>;
export type ConversationPeer = z.infer<typeof conversationPeerSchema>;
export type MessageResponse = z.infer<typeof messageSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
export type MessagesResponse = z.infer<typeof messagesResponseSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export type MarkConversationReadInput = z.infer<typeof markConversationReadInputSchema>;
export type MarkConversationReadResponse = z.infer<typeof markConversationReadResponseSchema>;
export type MessageCreatedPayload = z.infer<typeof messageCreatedPayloadSchema>;
export type MessageCreatedEvent = z.infer<typeof messageCreatedEventSchema>;
export type RealtimeMessageCreated = z.infer<typeof realtimeMessageCreatedSchema>;
