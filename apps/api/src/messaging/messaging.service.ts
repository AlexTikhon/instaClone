import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type {
  ConversationListQuery,
  ConversationListResponse,
  ConversationSummary,
  MarkConversationReadInput,
  MarkConversationReadResponse,
  MessagesQuery,
  MessagesResponse,
  SendMessageInput,
  MessageResponse,
} from '@instaclone/api-contracts';

import { ApiError } from '../platform/errors/api-error';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor';
import { decodeMessageCursor, encodeMessageCursor } from './message-cursor';
import { MESSAGING_REPOSITORY, type MessagingRepository } from './messaging.repository';

@Injectable()
export class MessagingService {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly messaging: MessagingRepository) {}

  async create(actorId: string, participantUserId: string): Promise<ConversationSummary> {
    const result = await this.messaging.createOrGet(actorId, participantUserId);
    if (result.kind === 'created') return result.conversation;
    if (result.kind === 'self') {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'SELF_CONVERSATION_NOT_ALLOWED',
        'You cannot start a conversation with yourself',
      );
    }
    throw new ApiError(HttpStatus.NOT_FOUND, 'USER_NOT_AVAILABLE', 'User is not available');
  }

  async list(actorId: string, query: ConversationListQuery): Promise<ConversationListResponse> {
    const page = await this.messaging.list(
      actorId,
      query.limit,
      query.cursor ? decodeConversationCursor(query.cursor) : null,
    );
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.next ? encodeConversationCursor(page.next) : null,
    };
  }

  async find(actorId: string, conversationId: string): Promise<ConversationSummary> {
    const conversation = await this.messaging.find(actorId, conversationId);
    if (!conversation) this.notFound();
    return conversation;
  }

  async messages(
    actorId: string,
    conversationId: string,
    query: MessagesQuery,
  ): Promise<MessagesResponse> {
    const page = await this.messaging.listMessages(
      actorId,
      conversationId,
      query.limit,
      query.before ? decodeMessageCursor(query.before, conversationId) : null,
    );
    if (!page) this.notFound();
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextSequence
        ? encodeMessageCursor({ conversationId, beforeSequence: page.nextSequence })
        : null,
    };
  }

  async send(
    actorId: string,
    conversationId: string,
    input: SendMessageInput,
    correlationId: string,
  ): Promise<MessageResponse> {
    const result = await this.messaging.send(actorId, conversationId, input, correlationId);
    if (result.kind === 'sent' || result.kind === 'existing') return result.message;
    if (result.kind === 'not_found') this.notFound();
    if (result.kind === 'idempotency_conflict') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CLIENT_MESSAGE_ID_REUSED',
        'Client message ID was already used for different content',
      );
    }
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'MESSAGING_FORBIDDEN',
      'New messages are not allowed in this conversation',
    );
  }

  async markRead(
    actorId: string,
    conversationId: string,
    input: MarkConversationReadInput,
  ): Promise<MarkConversationReadResponse> {
    const result = await this.messaging.markRead(actorId, conversationId, input.messageId);
    if (!result) this.notFound();
    return { conversationId, ...result };
  }

  private notFound(): never {
    throw new ApiError(
      HttpStatus.NOT_FOUND,
      'CONVERSATION_NOT_FOUND',
      'Conversation was not found',
    );
  }
}
