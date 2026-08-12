import {
  conversationListResponseSchema,
  conversationSummarySchema,
  markConversationReadResponseSchema,
  messageSchema,
  messagesResponseSchema,
  type ConversationListResponse,
  type ConversationSummary,
  type MarkConversationReadResponse,
  type MessageResponse,
  type MessagesResponse,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import { apiRequest } from '../../shared/api/http-client';

export const getConversations = async (cursor?: string): Promise<ConversationListResponse> => {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/conversations?${query.toString()}`);
  return conversationListResponseSchema.parse(await response.json());
};

export const getConversation = async (conversationId: string): Promise<ConversationSummary> => {
  const response = await apiRequest(`/conversations/${conversationId}`);
  return conversationSummarySchema.parse(await response.json());
};

export const createConversation = async (
  participantUserId: string,
): Promise<ConversationSummary> => {
  const response = await apiRequest('/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await getCsrfToken() },
    body: JSON.stringify({ participantUserId }),
  });
  return conversationSummarySchema.parse(await response.json());
};

export const getMessages = async (
  conversationId: string,
  before?: string,
): Promise<MessagesResponse> => {
  const query = new URLSearchParams({ limit: '30' });
  if (before) query.set('before', before);
  const response = await apiRequest(
    `/conversations/${conversationId}/messages?${query.toString()}`,
  );
  return messagesResponseSchema.parse(await response.json());
};

export const sendMessage = async (
  conversationId: string,
  input: { text: string; clientMessageId: string },
): Promise<MessageResponse> => {
  const response = await apiRequest(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await getCsrfToken() },
    body: JSON.stringify(input),
  });
  return messageSchema.parse(await response.json());
};

export const markConversationRead = async (
  conversationId: string,
  messageId: string,
): Promise<MarkConversationReadResponse> => {
  const response = await apiRequest(`/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await getCsrfToken() },
    body: JSON.stringify({ messageId }),
  });
  return markConversationReadResponseSchema.parse(await response.json());
};
