import { Injectable } from '@nestjs/common';

import {
  MESSAGE_CREATED_EVENT,
  type ConversationSummary,
  type MessageResponse,
  type SendMessageInput,
} from '@instaclone/api-contracts';

import { Prisma } from '../generated/prisma/client';
import type { Message } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { SocialInteractionPolicy } from '../social-graph/social-interaction.policy';
import type { ConversationCursor } from './conversation-cursor';
import type { MessageCursor } from './message-cursor';
import type { MessagingRepository } from './messaging.repository';
import type {
  ConversationPage,
  CreateConversationResult,
  MessagePage,
  ReadConversationResult,
  SendMessageResult,
} from './messaging.types';

interface ConversationRow {
  id: string;
  peerUserId: string;
  peerUsername: string;
  peerDisplayName: string;
  peerAvailable: boolean;
  createdAt: Date;
  activityAt: Date;
  snapshotAt: Date;
  blocked: boolean;
  unreadCount: number;
  messageId: string | null;
  messageSenderId: string | null;
  messageSequence: bigint | null;
  messageBody: string | null;
  messageClientId: string | null;
  messageCreatedAt: Date | null;
}

const safeSequence = (value: bigint): number => {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw new Error('Message sequence exceeds API safe range');
  return sequence;
};

@Injectable()
export class PrismaMessagingRepository implements MessagingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interactionPolicy: SocialInteractionPolicy,
  ) {}

  async createOrGet(actorId: string, participantUserId: string): Promise<CreateConversationResult> {
    if (actorId === participantUserId) return { kind: 'self' };
    const result = await this.runSerializable(async (transaction) => {
      await this.interactionPolicy.lockPair(transaction, actorId, participantUserId);
      const state = await this.interactionPolicy.messagingPairState(
        transaction,
        actorId,
        participantUserId,
      );
      if (!state.available) return { kind: 'unavailable' as const };
      if (state.blocked) return { kind: 'blocked' as const };
      const [lowerUserId, higherUserId] = this.interactionPolicy.canonicalPair(
        actorId,
        participantUserId,
      );
      const conversation = await transaction.conversation.upsert({
        where: { lowerUserId_higherUserId: { lowerUserId, higherUserId } },
        create: { lowerUserId, higherUserId },
        update: {},
        select: { id: true },
      });
      return { kind: 'ready' as const, conversationId: conversation.id };
    });
    if (result.kind !== 'ready') return result;
    const conversation = await this.find(actorId, result.conversationId);
    if (!conversation) throw new Error('Created conversation was not readable');
    return { kind: 'created', conversation };
  }

  async list(
    actorId: string,
    limit: number,
    cursor: ConversationCursor | null,
  ): Promise<ConversationPage> {
    const rows = await this.conversationRows(actorId, limit + 1, cursor, null);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = hasMore ? page.at(-1) : undefined;
    return {
      items: page.map((row) => this.toConversation(row)),
      hasMore,
      next: last
        ? {
            snapshotAt: last.snapshotAt,
            activityAt: last.activityAt,
            conversationId: last.id,
          }
        : null,
    };
  }

  async find(actorId: string, conversationId: string): Promise<ConversationSummary | null> {
    const rows = await this.conversationRows(actorId, 1, null, conversationId);
    return rows[0] ? this.toConversation(rows[0]) : null;
  }

  async listMessages(
    actorId: string,
    conversationId: string,
    limit: number,
    cursor: MessageCursor | null,
  ): Promise<MessagePage | null> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ lowerUserId: actorId }, { higherUserId: actorId }],
      },
      select: { id: true },
    });
    if (!conversation) return null;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(cursor ? { sequence: { lt: cursor.beforeSequence } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map((message) => this.toMessage(message)),
      hasMore,
      nextSequence: hasMore ? (page.at(-1)?.sequence ?? null) : null,
    };
  }

  async send(
    actorId: string,
    conversationId: string,
    input: SendMessageInput,
    correlationId: string,
  ): Promise<SendMessageResult> {
    const existing = await this.prisma.message.findUnique({
      where: {
        senderId_clientMessageId: { senderId: actorId, clientMessageId: input.clientMessageId },
      },
    });
    if (existing) return this.existingResult(existing, conversationId, input.text);

    try {
      return await this.runSerializable(async (transaction) => {
        const conversation = await transaction.conversation.findFirst({
          where: {
            id: conversationId,
            OR: [{ lowerUserId: actorId }, { higherUserId: actorId }],
          },
        });
        if (!conversation) return { kind: 'not_found' as const };

        await this.interactionPolicy.lockPair(
          transaction,
          conversation.lowerUserId,
          conversation.higherUserId,
        );
        const retry = await transaction.message.findUnique({
          where: {
            senderId_clientMessageId: {
              senderId: actorId,
              clientMessageId: input.clientMessageId,
            },
          },
        });
        if (retry) return this.existingResult(retry, conversationId, input.text);

        const state = await this.interactionPolicy.messagingPairState(
          transaction,
          conversation.lowerUserId,
          conversation.higherUserId,
        );
        if (!state.available) return { kind: 'unavailable' as const };
        if (state.blocked) return { kind: 'blocked' as const };

        const databaseTimes = await transaction.$queryRaw<{ now: Date }[]>`
          SELECT CURRENT_TIMESTAMP AS "now"
        `;
        const now = databaseTimes[0]?.now;
        if (!now) throw new Error('Database did not return transaction time');
        const updated = await transaction.conversation.update({
          where: { id: conversationId },
          data: { lastSequence: { increment: 1 }, lastMessageAt: now },
          select: { lastSequence: true },
        });
        const message = await transaction.message.create({
          data: {
            conversationId,
            senderId: actorId,
            sequence: updated.lastSequence,
            body: input.text,
            clientMessageId: input.clientMessageId,
            createdAt: now,
          },
        });
        await transaction.$executeRaw`
          UPDATE "conversations"
          SET "lowerLastReadSequence" = CASE
                WHEN "lowerUserId" = ${actorId}::uuid
                THEN GREATEST("lowerLastReadSequence", ${updated.lastSequence})
                ELSE "lowerLastReadSequence"
              END,
              "higherLastReadSequence" = CASE
                WHEN "higherUserId" = ${actorId}::uuid
                THEN GREATEST("higherLastReadSequence", ${updated.lastSequence})
                ELSE "higherLastReadSequence"
              END
          WHERE "id" = ${conversationId}::uuid
        `;
        const recipientId =
          actorId === conversation.lowerUserId
            ? conversation.higherUserId
            : conversation.lowerUserId;
        const event = createOutboxEvent({
          eventName: MESSAGE_CREATED_EVENT,
          aggregateType: 'Message',
          aggregateId: message.id,
          correlationId,
          occurredAt: now,
          payload: {
            conversationId,
            messageId: message.id,
            senderId: actorId,
            recipientId,
            sequence: safeSequence(message.sequence),
            occurredAt: now.toISOString(),
          },
        });
        await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
        return { kind: 'sent' as const, message: this.toMessage(message) };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const retry = await this.prisma.message.findUnique({
        where: {
          senderId_clientMessageId: { senderId: actorId, clientMessageId: input.clientMessageId },
        },
      });
      return retry
        ? this.existingResult(retry, conversationId, input.text)
        : { kind: 'idempotency_conflict' };
    }
  }

  async markRead(
    actorId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ReadConversationResult | null> {
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.message.findFirst({
        where: {
          id: messageId,
          conversationId,
          conversation: { OR: [{ lowerUserId: actorId }, { higherUserId: actorId }] },
        },
        select: { sequence: true },
      });
      if (!message) return null;
      const rows = await transaction.$queryRaw<{ lastReadSequence: bigint }[]>`
        UPDATE "conversations"
        SET "lowerLastReadSequence" = CASE
              WHEN "lowerUserId" = ${actorId}::uuid
              THEN GREATEST("lowerLastReadSequence", ${message.sequence})
              ELSE "lowerLastReadSequence"
            END,
            "higherLastReadSequence" = CASE
              WHEN "higherUserId" = ${actorId}::uuid
              THEN GREATEST("higherLastReadSequence", ${message.sequence})
              ELSE "higherLastReadSequence"
            END
        WHERE "id" = ${conversationId}::uuid
          AND ${actorId}::uuid IN ("lowerUserId", "higherUserId")
        RETURNING CASE
          WHEN "lowerUserId" = ${actorId}::uuid THEN "lowerLastReadSequence"
          ELSE "higherLastReadSequence"
        END AS "lastReadSequence"
      `;
      const lastRead = rows[0]?.lastReadSequence;
      if (lastRead === undefined) return null;
      const unreadCount = await transaction.message.count({
        where: { conversationId, sequence: { gt: lastRead }, senderId: { not: actorId } },
      });
      return { lastReadSequence: safeSequence(lastRead), unreadCount };
    });
  }

  private async conversationRows(
    actorId: string,
    limit: number,
    cursor: ConversationCursor | null,
    conversationId: string | null,
  ): Promise<ConversationRow[]> {
    const snapshotAt = cursor?.snapshotAt ?? null;
    const idFilter = conversationId
      ? Prisma.sql`AND c."id" = ${conversationId}::uuid`
      : Prisma.empty;
    const cursorFilter = cursor
      ? Prisma.sql`
          WHERE summaries."activityAt" < ${cursor.activityAt}
             OR (
               summaries."activityAt" = ${cursor.activityAt}
               AND summaries.id < ${cursor.conversationId}::uuid
             )
        `
      : Prisma.empty;
    return this.prisma.$queryRaw<ConversationRow[]>(Prisma.sql`
      WITH params AS (
        SELECT COALESCE(${snapshotAt}::timestamptz, CURRENT_TIMESTAMP) AS "snapshotAt"
      ),
      summaries AS (
        SELECT
          c.id,
          CASE WHEN c."lowerUserId" = ${actorId}::uuid
            THEN c."higherUserId" ELSE c."lowerUserId" END AS "peerUserId",
          COALESCE(pr.username, 'unavailable') AS "peerUsername",
          COALESCE(pr."displayName", 'Unavailable account') AS "peerDisplayName",
          (peer."disabledAt" IS NULL AND pr."userId" IS NOT NULL) AS "peerAvailable",
          c."createdAt",
          COALESCE(latest."createdAt", c."createdAt") AS "activityAt",
          params."snapshotAt",
          EXISTS (
            SELECT 1 FROM blocks b
            WHERE (b."blockerId" = c."lowerUserId" AND b."blockedId" = c."higherUserId")
               OR (b."blockerId" = c."higherUserId" AND b."blockedId" = c."lowerUserId")
          ) AS blocked,
          (
            SELECT COUNT(*)::integer FROM messages unread
            WHERE unread."conversationId" = c.id
              AND unread.sequence > CASE WHEN c."lowerUserId" = ${actorId}::uuid
                THEN c."lowerLastReadSequence" ELSE c."higherLastReadSequence" END
              AND unread."senderId" <> ${actorId}::uuid
              AND unread."createdAt" <= params."snapshotAt"
          ) AS "unreadCount",
          latest.id AS "messageId",
          latest."senderId" AS "messageSenderId",
          latest.sequence AS "messageSequence",
          latest.body AS "messageBody",
          latest."clientMessageId" AS "messageClientId",
          latest."createdAt" AS "messageCreatedAt"
        FROM conversations c
        CROSS JOIN params
        JOIN users peer ON peer.id = CASE WHEN c."lowerUserId" = ${actorId}::uuid
          THEN c."higherUserId" ELSE c."lowerUserId" END
        LEFT JOIN profiles pr ON pr."userId" = peer.id
        LEFT JOIN LATERAL (
          SELECT m.id, m."senderId", m.sequence, m.body, m."clientMessageId", m."createdAt"
          FROM messages m
          WHERE m."conversationId" = c.id AND m."createdAt" <= params."snapshotAt"
          ORDER BY m.sequence DESC
          LIMIT 1
        ) latest ON true
        WHERE ${actorId}::uuid IN (c."lowerUserId", c."higherUserId")
          AND c."createdAt" <= params."snapshotAt"
          ${idFilter}
      )
      SELECT * FROM summaries
      ${cursorFilter}
      ORDER BY summaries."activityAt" DESC, summaries.id DESC
      LIMIT ${limit}
    `);
  }

  private toConversation(row: ConversationRow): ConversationSummary {
    return {
      id: row.id,
      peer: {
        userId: row.peerUserId,
        username: row.peerUsername,
        displayName: row.peerDisplayName,
        isAvailable: row.peerAvailable,
      },
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.activityAt.toISOString(),
      lastMessage:
        row.messageId &&
        row.messageSenderId &&
        row.messageSequence !== null &&
        row.messageBody !== null &&
        row.messageClientId &&
        row.messageCreatedAt
          ? {
              id: row.messageId,
              conversationId: row.id,
              senderId: row.messageSenderId,
              sequence: safeSequence(row.messageSequence),
              text: row.messageBody,
              clientMessageId: row.messageClientId,
              createdAt: row.messageCreatedAt.toISOString(),
            }
          : null,
      unreadCount: row.unreadCount,
      blocked: row.blocked || !row.peerAvailable,
    };
  }

  private toMessage(message: Message): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      sequence: safeSequence(message.sequence),
      text: message.body,
      clientMessageId: message.clientMessageId,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private existingResult(
    message: Message,
    conversationId: string,
    text: string,
  ): SendMessageResult {
    return message.conversationId === conversationId && message.body === text
      ? { kind: 'existing', message: this.toMessage(message) }
      : { kind: 'idempotency_conflict' };
  }

  private async runSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') {
          throw error;
        }
      }
    }
    return this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
  }
}
