import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  ACCOUNT_SUSPENDED_EVENT,
  CONTENT_MODERATED_EVENT,
  type ModerationCaseDetail,
  type ModerationCaseSummary,
  type ModerationTargetType,
} from '@instaclone/api-contracts';

import { AccountAccessPolicy } from '../account-access/account-access-policy';
import { CommentModerationPolicy } from '../engagement/comment-moderation-policy';
import { Prisma, type ModerationCaseStatus } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createOutboxEvent } from '../outbox/event-envelope';
import { ApiError } from '../platform/errors/api-error';
import { PostAccessPolicy } from '../post-access/post-access-policy';
import { StoryAccessPolicy } from '../stories/story-access-policy';
import { ReelAccessPolicy } from '../reels/reel-access-policy';
import { DuplicateActiveReportError, type ModerationRepository } from './moderation.repository';
import { ModerationPolicy } from './moderation-policy';
import type {
  CreateReportCommand,
  ListModerationCasesInput,
  ResolveCaseCommand,
} from './moderation.types';

interface EvidenceSnapshot {
  targetType: ModerationTargetType;
  targetId: string;
  ownerId: string;
  username: string;
  text: string | null;
  mediaAssetIds: string[];
}

interface LockedCase {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  status: ModerationCaseStatus;
}

const mediaIdsSchema = z.array(z.uuid()).max(10);
const ACTIVE_CASE_STATUSES: ModerationCaseStatus[] = ['OPEN', 'IN_REVIEW'];

@Injectable()
export class PrismaModerationRepository implements ModerationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountAccess: AccountAccessPolicy,
    private readonly postAccess: PostAccessPolicy,
    private readonly storyAccess: StoryAccessPolicy,
    private readonly reelAccess: ReelAccessPolicy,
    private readonly commentModeration: CommentModerationPolicy,
    private readonly policy: ModerationPolicy,
  ) {}

  async createReport(command: CreateReportCommand): Promise<string> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const lockKey = `${command.targetType}:${command.targetId}`;
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        );
        const evidence = await this.requireEvidence(transaction, command);
        let moderationCase = await transaction.moderationCase.findFirst({
          where: {
            targetType: command.targetType,
            targetId: command.targetId,
            status: { in: ACTIVE_CASE_STATUSES },
          },
          select: { id: true },
        });
        moderationCase ??= await transaction.moderationCase.create({
          data: {
            targetType: command.targetType,
            targetId: command.targetId,
            ...this.targetFields(command.targetType, command.targetId),
          },
          select: { id: true },
        });
        const report = await transaction.report.create({
          data: {
            caseId: moderationCase.id,
            reporterId: command.reporterId,
            targetType: command.targetType,
            targetId: command.targetId,
            ...this.targetFields(command.targetType, command.targetId),
            reason: command.reason,
            ...(command.details ? { details: command.details } : {}),
            snapshotText: evidence.text,
            snapshotUsername: evidence.username,
            snapshotOwnerId: evidence.ownerId,
            snapshotMediaAssetIds: evidence.mediaAssetIds,
          },
          select: { id: true },
        });
        return report.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateActiveReportError('An equivalent active report already exists');
      }
      throw error;
    }
  }

  async listCases(input: ListModerationCasesInput): Promise<{
    cases: ModerationCaseSummary[];
    hasMore: boolean;
  }> {
    const rows = await this.prisma.moderationCase.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      include: { _count: { select: { reports: true } } },
    });
    const hasMore = rows.length > input.limit;
    return {
      cases: rows.slice(0, input.limit).map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        status: row.status,
        reportCount: row._count.reports,
        reviewerId: row.reviewerId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
      })),
      hasMore,
    };
  }

  async findCase(caseId: string): Promise<ModerationCaseDetail | null> {
    const row = await this.prisma.moderationCase.findUnique({
      where: { id: caseId },
      include: {
        reports: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51 },
        decision: true,
        auditEntries: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        _count: { select: { reports: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      status: row.status,
      reportCount: row._count.reports,
      reviewerId: row.reviewerId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      reports: row.reports.slice(0, 50).map((report) => ({
        id: report.id,
        reporterId: report.reporterId,
        reason: report.reason,
        details: report.details,
        snapshot: {
          text: report.snapshotText,
          username: report.snapshotUsername,
          ownerId: report.snapshotOwnerId,
          mediaAssetIds: mediaIdsSchema.parse(report.snapshotMediaAssetIds),
        },
        createdAt: report.createdAt.toISOString(),
      })),
      reportsTruncated: row.reports.length > 50,
      decision: row.decision
        ? {
            action: row.decision.action,
            actorUserId: row.decision.actorUserId,
            internalNote: row.decision.internalNote,
            createdAt: row.decision.createdAt.toISOString(),
          }
        : null,
      audit: row.auditEntries.map((entry) => ({
        id: entry.id,
        actorUserId: entry.actorUserId,
        action: entry.action,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async startReview(caseId: string, actorId: string): Promise<ModerationCaseDetail> {
    await this.prisma.$transaction(async (transaction) => {
      const moderationCase = await this.lockCase(transaction, caseId);
      this.policy.assertTransition(moderationCase.status, 'IN_REVIEW');
      await transaction.moderationCase.update({
        where: { id: caseId },
        data: { status: 'IN_REVIEW', reviewerId: actorId },
      });
      await transaction.moderationAuditLog.create({
        data: {
          caseId,
          actorUserId: actorId,
          action: 'START_REVIEW',
          targetType: moderationCase.targetType,
          targetId: moderationCase.targetId,
        },
      });
    });
    return this.requireCase(caseId);
  }

  async resolve(command: ResolveCaseCommand): Promise<ModerationCaseDetail> {
    await this.prisma.$transaction(async (transaction) => {
      const moderationCase = await this.lockCase(transaction, command.caseId);
      this.policy.assertTransition(moderationCase.status, 'CLOSED');
      this.policy.assertAction(moderationCase.targetType, command.action, command.actor.role);
      if (command.action === 'SUSPEND_ACCOUNT' && moderationCase.targetId === command.actor.id) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'SELF_SUSPENSION_NOT_ALLOWED',
          'An administrator cannot suspend their own account',
        );
      }

      const nowRows = await transaction.$queryRaw<{ now: Date }[]>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      const now = nowRows[0]?.now;
      if (!now) throw new Error('Database did not return transaction time');
      await this.applyEnforcement(transaction, moderationCase, command.action, now);
      await transaction.moderationDecision.create({
        data: {
          caseId: command.caseId,
          actorUserId: command.actor.id,
          action: command.action,
          ...(command.internalNote ? { internalNote: command.internalNote } : {}),
          createdAt: now,
        },
      });
      await transaction.moderationAuditLog.create({
        data: {
          caseId: command.caseId,
          actorUserId: command.actor.id,
          action: command.action,
          targetType: moderationCase.targetType,
          targetId: moderationCase.targetId,
          createdAt: now,
        },
      });
      if (command.action !== 'NO_ACTION') {
        const eventName =
          command.action === 'SUSPEND_ACCOUNT' ? ACCOUNT_SUSPENDED_EVENT : CONTENT_MODERATED_EVENT;
        const event = createOutboxEvent({
          eventName,
          aggregateType: 'ModerationCase',
          aggregateId: command.caseId,
          correlationId: command.correlationId,
          occurredAt: now,
          payload: {
            targetType: moderationCase.targetType,
            targetId: moderationCase.targetId,
            action: command.action,
            occurredAt: now.toISOString(),
          },
        });
        await transaction.outboxEvent.create({ data: { ...event, payload: event.payload } });
      }
      await transaction.report.updateMany({
        where: { caseId: command.caseId, status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: now },
      });
      await transaction.moderationCase.update({
        where: { id: command.caseId },
        data: { status: 'CLOSED', reviewerId: command.actor.id, closedAt: now },
      });
    });
    return this.requireCase(command.caseId);
  }

  private async requireEvidence(
    transaction: Prisma.TransactionClient,
    command: CreateReportCommand,
  ): Promise<EvidenceSnapshot> {
    if (command.targetType === 'USER') {
      if (command.targetId === command.reporterId) this.reportTargetNotFound();
      const user = await transaction.user.findFirst({
        where: {
          id: command.targetId,
          ...this.accountAccess.visibleWhere(command.reporterId),
        },
        select: { id: true, profile: true },
      });
      if (!user?.profile) this.reportTargetNotFound();
      return {
        targetType: 'USER',
        targetId: user.id,
        ownerId: user.id,
        username: user.profile.username,
        text: user.profile.bio || null,
        mediaAssetIds: [],
      };
    }
    if (command.targetType === 'POST') {
      const post = await transaction.post.findFirst({
        where: {
          id: command.targetId,
          authorId: { not: command.reporterId },
          ...this.postAccess.visibleWhere(command.reporterId),
        },
        select: {
          id: true,
          authorId: true,
          caption: true,
          author: { select: { profile: { select: { username: true } } } },
          media: { orderBy: { position: 'asc' }, select: { mediaAssetId: true }, take: 10 },
        },
      });
      if (!post?.author.profile) this.reportTargetNotFound();
      return {
        targetType: 'POST',
        targetId: post.id,
        ownerId: post.authorId,
        username: post.author.profile.username,
        text: post.caption || null,
        mediaAssetIds: post.media.map((item) => item.mediaAssetId),
      };
    }
    if (command.targetType === 'COMMENT') {
      const comment = await transaction.comment.findFirst({
        where: {
          id: command.targetId,
          authorId: { not: command.reporterId },
          deletedAt: null,
          moderationRemovedAt: null,
          author: { disabledAt: null, profile: { isNot: null } },
          post: { is: this.postAccess.visibleWhere(command.reporterId) },
        },
        select: {
          id: true,
          authorId: true,
          body: true,
          author: { select: { profile: { select: { username: true } } } },
        },
      });
      if (!comment?.author.profile) this.reportTargetNotFound();
      return {
        targetType: 'COMMENT',
        targetId: comment.id,
        ownerId: comment.authorId,
        username: comment.author.profile.username,
        text: comment.body,
        mediaAssetIds: [],
      };
    }

    if (command.targetType === 'REEL') {
      const reel = await transaction.reel.findFirst({
        where: {
          id: command.targetId,
          authorId: { not: command.reporterId },
          ...this.reelAccess.visibleWhere(command.reporterId),
        },
        select: {
          id: true,
          authorId: true,
          caption: true,
          mediaAssetId: true,
          author: { select: { profile: { select: { username: true } } } },
        },
      });
      if (!reel?.author.profile) this.reportTargetNotFound();
      return {
        targetType: 'REEL',
        targetId: reel.id,
        ownerId: reel.authorId,
        username: reel.author.profile.username,
        text: reel.caption || null,
        mediaAssetIds: [reel.mediaAssetId],
      };
    }

    const stories = await transaction.$queryRaw<
      { id: string; authorId: string; username: string; mediaAssetId: string }[]
    >(Prisma.sql`
      SELECT story.id, story."authorId" AS "authorId", profile.username,
        story."mediaAssetId" AS "mediaAssetId"
      FROM stories story
      JOIN users author ON author.id = story."authorId"
      JOIN profiles profile ON profile."userId" = author.id
      WHERE story.id = ${command.targetId}::uuid
        AND story."authorId" <> ${command.reporterId}::uuid
        AND ${this.storyAccess.activeStory()}
        AND ${this.storyAccess.visibleAuthor(command.reporterId)}
      LIMIT 1
    `);
    const story = stories[0];
    if (!story) this.reportTargetNotFound();
    return {
      targetType: 'STORY',
      targetId: story.id,
      ownerId: story.authorId,
      username: story.username,
      text: null,
      mediaAssetIds: [story.mediaAssetId],
    };
  }

  private async applyEnforcement(
    transaction: Prisma.TransactionClient,
    moderationCase: LockedCase,
    action: 'NO_ACTION' | 'REMOVE_CONTENT' | 'SUSPEND_ACCOUNT',
    now: Date,
  ): Promise<void> {
    if (action === 'NO_ACTION') return;
    let enforced = false;
    if (action === 'SUSPEND_ACCOUNT') {
      enforced = await this.accountAccess.suspend(transaction, moderationCase.targetId, now);
    } else if (moderationCase.targetType === 'POST') {
      enforced = await this.postAccess.removeByModeration(
        transaction,
        moderationCase.targetId,
        now,
      );
    } else if (moderationCase.targetType === 'COMMENT') {
      enforced = await this.commentModeration.remove(transaction, moderationCase.targetId, now);
    } else if (moderationCase.targetType === 'STORY') {
      enforced = await this.storyAccess.removeByModeration(
        transaction,
        moderationCase.targetId,
        now,
      );
    } else if (moderationCase.targetType === 'REEL') {
      enforced = await this.reelAccess.removeByModeration(
        transaction,
        moderationCase.targetId,
        now,
      );
    }
    if (!enforced) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'MODERATION_TARGET_UNAVAILABLE',
        'The moderation target can no longer accept this action',
      );
    }
  }

  private async lockCase(
    transaction: Prisma.TransactionClient,
    caseId: string,
  ): Promise<LockedCase> {
    const rows = await transaction.$queryRaw<LockedCase[]>(Prisma.sql`
      SELECT id, "targetType", "targetId", status
      FROM moderation_cases
      WHERE id = ${caseId}::uuid
      FOR UPDATE
    `);
    const moderationCase = rows[0];
    if (!moderationCase) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'MODERATION_CASE_NOT_FOUND',
        'Moderation case was not found',
      );
    }
    return moderationCase;
  }

  private async requireCase(caseId: string): Promise<ModerationCaseDetail> {
    const detail = await this.findCase(caseId);
    if (!detail) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'MODERATION_CASE_NOT_FOUND',
        'Moderation case was not found',
      );
    }
    return detail;
  }

  private targetFields(targetType: ModerationTargetType, targetId: string) {
    return {
      userTargetId: targetType === 'USER' ? targetId : null,
      postTargetId: targetType === 'POST' ? targetId : null,
      commentTargetId: targetType === 'COMMENT' ? targetId : null,
      storyTargetId: targetType === 'STORY' ? targetId : null,
      reelTargetId: targetType === 'REEL' ? targetId : null,
    };
  }

  private reportTargetNotFound(): never {
    throw new ApiError(
      HttpStatus.NOT_FOUND,
      'REPORT_TARGET_NOT_FOUND',
      'Report target was not found',
    );
  }
}
