import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  conversationIdSchema,
  conversationListQuerySchema,
  createConversationInputSchema,
  markConversationReadInputSchema,
  messagesQuerySchema,
  sendMessageInputSchema,
  type ConversationListResponse,
  type ConversationSummary,
  type MarkConversationReadResponse,
  type MessageResponse,
  type MessagesResponse,
} from '@instaclone/api-contracts';

import { AccessAuthGuard } from '../auth/access-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AuthRateLimitGuard, RequestRateLimit } from '../auth/auth-rate-limit.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { parseRequest } from '../auth/request-validation';
import { VerifiedEmailGuard } from '../auth/verified-email.guard';
import { MessagingService } from './messaging.service';

@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ConversationSummary> {
    const input = parseRequest(createConversationInputSchema, body);
    return this.messaging.create(request.identity.id, input.participantUserId);
  }

  @Get()
  @UseGuards(AccessAuthGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<ConversationListResponse> {
    return this.messaging.list(
      request.identity.id,
      parseRequest(conversationListQuerySchema, query),
    );
  }

  @Get(':conversationId')
  @UseGuards(AccessAuthGuard)
  find(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationSummary> {
    return this.messaging.find(request.identity.id, this.conversationId(conversationId));
  }

  @Get(':conversationId/messages')
  @UseGuards(AccessAuthGuard)
  messages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Query() query: unknown,
  ): Promise<MessagesResponse> {
    return this.messaging.messages(
      request.identity.id,
      this.conversationId(conversationId),
      parseRequest(messagesQuerySchema, query),
    );
  }

  @Post(':conversationId/messages')
  @HttpCode(200)
  @RequestRateLimit({ bucket: 'message-send', limit: 60, windowSeconds: 60 })
  @UseGuards(AccessAuthGuard, VerifiedEmailGuard, CsrfGuard, AuthRateLimitGuard)
  send(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ): Promise<MessageResponse> {
    return this.messaging.send(
      request.identity.id,
      this.conversationId(conversationId),
      parseRequest(sendMessageInputSchema, body),
      request.id,
    );
  }

  @Post(':conversationId/read')
  @HttpCode(200)
  @UseGuards(AccessAuthGuard, CsrfGuard)
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ): Promise<MarkConversationReadResponse> {
    return this.messaging.markRead(
      request.identity.id,
      this.conversationId(conversationId),
      parseRequest(markConversationReadInputSchema, body),
    );
  }

  private conversationId(value: string): string {
    return parseRequest(conversationIdSchema, value);
  }
}
