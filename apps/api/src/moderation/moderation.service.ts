import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type {
  CreateReportInput,
  CreateReportResponse,
  ModerationCaseDetail,
  ModerationCasesQuery,
  ModerationCasesResponse,
  ResolveModerationCaseInput,
} from '@instaclone/api-contracts';

import { ApiError } from '../platform/errors/api-error';
import { decodeModerationCaseCursor, encodeModerationCaseCursor } from './moderation-cursor';
import {
  DuplicateActiveReportError,
  MODERATION_REPOSITORY,
  type ModerationRepository,
} from './moderation.repository';
import {
  InvalidModerationActionError,
  InvalidModerationTransitionError,
} from './moderation-policy';
import type { ModerationActor } from './moderation.types';

@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ModerationService.name);
  }

  async report(reporterId: string, input: CreateReportInput): Promise<CreateReportResponse> {
    try {
      const reportId = await this.moderation.createReport({ reporterId, ...input });
      this.logger.info(
        { reportId, reporterId, targetType: input.targetType, targetId: input.targetId },
        'report received',
      );
      return { reportId, status: 'RECEIVED' };
    } catch (error) {
      if (error instanceof DuplicateActiveReportError) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'DUPLICATE_ACTIVE_REPORT',
          'An equivalent report is already active',
        );
      }
      throw error;
    }
  }

  async listCases(query: ModerationCasesQuery): Promise<ModerationCasesResponse> {
    const page = await this.moderation.listCases({
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      limit: query.limit,
      cursor: query.cursor ? decodeModerationCaseCursor(query.cursor) : null,
    });
    const last = page.hasMore ? page.cases.at(-1) : undefined;
    return {
      cases: page.cases,
      hasMore: page.hasMore,
      nextCursor: last
        ? encodeModerationCaseCursor({ createdAt: new Date(last.createdAt), id: last.id })
        : null,
    };
  }

  async findCase(caseId: string): Promise<ModerationCaseDetail> {
    const detail = await this.moderation.findCase(caseId);
    if (!detail) this.caseNotFound();
    return detail;
  }

  async startReview(caseId: string, actor: ModerationActor): Promise<ModerationCaseDetail> {
    try {
      const detail = await this.moderation.startReview(caseId, actor.id);
      this.logger.info({ caseId, actorId: actor.id }, 'moderation review started');
      return detail;
    } catch (error) {
      this.mapPolicyError(error);
    }
  }

  async resolve(
    caseId: string,
    actor: ModerationActor,
    input: ResolveModerationCaseInput,
    correlationId: string,
  ): Promise<ModerationCaseDetail> {
    try {
      const detail = await this.moderation.resolve({
        actor,
        caseId,
        action: input.action,
        ...(input.internalNote ? { internalNote: input.internalNote } : {}),
        correlationId,
      });
      this.logger.info(
        {
          caseId,
          actorId: actor.id,
          action: input.action,
          targetType: detail.targetType,
          targetId: detail.targetId,
        },
        'moderation case resolved',
      );
      return detail;
    } catch (error) {
      this.mapPolicyError(error);
    }
  }

  private mapPolicyError(error: unknown): never {
    if (error instanceof InvalidModerationTransitionError) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'INVALID_MODERATION_TRANSITION',
        'The moderation case is not in a valid state for this operation',
      );
    }
    if (error instanceof InvalidModerationActionError) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'MODERATION_ACTION_FORBIDDEN',
        'This moderation action is not allowed for the actor or target',
      );
    }
    throw error;
  }

  private caseNotFound(): never {
    throw new ApiError(
      HttpStatus.NOT_FOUND,
      'MODERATION_CASE_NOT_FOUND',
      'Moderation case was not found',
    );
  }
}
