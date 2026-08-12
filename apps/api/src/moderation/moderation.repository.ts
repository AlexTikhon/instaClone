import type { ModerationCaseDetail, ModerationCaseSummary } from '@instaclone/api-contracts';

import type {
  CreateReportCommand,
  ListModerationCasesInput,
  ResolveCaseCommand,
} from './moderation.types';

export const MODERATION_REPOSITORY = Symbol('MODERATION_REPOSITORY');

export class DuplicateActiveReportError extends Error {}

export interface ModerationRepository {
  createReport(command: CreateReportCommand): Promise<string>;
  listCases(input: ListModerationCasesInput): Promise<{
    cases: ModerationCaseSummary[];
    hasMore: boolean;
  }>;
  findCase(caseId: string): Promise<ModerationCaseDetail | null>;
  startReview(caseId: string, actorId: string): Promise<ModerationCaseDetail>;
  resolve(command: ResolveCaseCommand): Promise<ModerationCaseDetail>;
}
