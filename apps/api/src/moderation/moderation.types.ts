import type {
  ModerationCaseDetail,
  ModerationCasesResponse,
  ModerationDecisionAction,
  ModerationTargetType,
  ReportReason,
} from '@instaclone/api-contracts';

export interface ModerationActor {
  id: string;
  role: 'MODERATOR' | 'ADMIN';
}

export interface CreateReportCommand {
  reporterId: string;
  targetType: ModerationTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

export interface ModerationCaseCursor {
  createdAt: Date;
  id: string;
}

export interface ListModerationCasesInput {
  status?: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
  targetType?: ModerationTargetType;
  limit: number;
  cursor: ModerationCaseCursor | null;
}

export interface ResolveCaseCommand {
  actor: ModerationActor;
  caseId: string;
  action: ModerationDecisionAction;
  internalNote?: string;
  correlationId: string;
}

export interface ModerationRepositoryResult {
  reportId?: string;
  caseDetail?: ModerationCaseDetail;
  casePage?: ModerationCasesResponse;
}
