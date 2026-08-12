import type { ConversationSummary, SendMessageInput } from '@instaclone/api-contracts';

import type { ConversationCursor } from './conversation-cursor';
import type { MessageCursor } from './message-cursor';
import type {
  ConversationPage,
  CreateConversationResult,
  MessagePage,
  ReadConversationResult,
  SendMessageResult,
} from './messaging.types';

export const MESSAGING_REPOSITORY = Symbol('MESSAGING_REPOSITORY');

export interface MessagingRepository {
  createOrGet(actorId: string, participantUserId: string): Promise<CreateConversationResult>;
  list(
    actorId: string,
    limit: number,
    cursor: ConversationCursor | null,
  ): Promise<ConversationPage>;
  find(actorId: string, conversationId: string): Promise<ConversationSummary | null>;
  listMessages(
    actorId: string,
    conversationId: string,
    limit: number,
    cursor: MessageCursor | null,
  ): Promise<MessagePage | null>;
  send(
    actorId: string,
    conversationId: string,
    input: SendMessageInput,
    correlationId: string,
  ): Promise<SendMessageResult>;
  markRead(
    actorId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ReadConversationResult | null>;
}
