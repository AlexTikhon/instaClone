'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MessageResponse } from '@instaclone/api-contracts';

import {
  getConversation,
  getConversations,
  getMessages,
  markConversationRead,
  sendMessage,
} from '../../entities/messaging/api';
import { mergeMessage, type MessagesCache } from './messaging-cache';
import { messagingKeys } from './query-keys';

export const useConversations = () =>
  useInfiniteQuery({
    queryKey: messagingKeys.conversations(),
    queryFn: ({ pageParam }) => getConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  });

export const useConversation = (conversationId: string | undefined) =>
  useQuery({
    queryKey: messagingKeys.conversation(conversationId ?? 'none'),
    queryFn: () => getConversation(conversationId!),
    enabled: Boolean(conversationId),
  });

export const useMessages = (conversationId: string | undefined) =>
  useInfiniteQuery({
    queryKey: messagingKeys.messages(conversationId ?? 'none'),
    queryFn: ({ pageParam }) => getMessages(conversationId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: Boolean(conversationId),
  });

export const useSendMessage = (conversationId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; clientMessageId: string }) =>
      sendMessage(conversationId, input),
    onSuccess: (message: MessageResponse) => {
      client.setQueryData<MessagesCache>(messagingKeys.messages(conversationId), (current) =>
        mergeMessage(current, message),
      );
      void Promise.all([
        client.invalidateQueries({ queryKey: messagingKeys.conversations() }),
        client.invalidateQueries({ queryKey: messagingKeys.conversation(conversationId) }),
      ]);
    },
  });
};

export const useMarkConversationRead = (conversationId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => markConversationRead(conversationId, messageId),
    onSuccess: () => {
      void Promise.all([
        client.invalidateQueries({ queryKey: messagingKeys.conversations() }),
        client.invalidateQueries({ queryKey: messagingKeys.conversation(conversationId) }),
      ]);
    },
  });
};
