import {
  createReportResponseSchema,
  moderationCaseDetailSchema,
  moderationCasesResponseSchema,
  type CreateReportInput,
  type CreateReportResponse,
  type ModerationCaseDetail,
  type ModerationCasesResponse,
  type ModerationDecisionAction,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import { apiRequest } from '../../shared/api/http-client';

export const createReport = async (input: CreateReportInput): Promise<CreateReportResponse> => {
  const response = await apiRequest('/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await getCsrfToken() },
    body: JSON.stringify(input),
  });
  return createReportResponseSchema.parse(await response.json());
};

export const listModerationCases = async (cursor?: string): Promise<ModerationCasesResponse> => {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/moderation/cases?${query.toString()}`);
  return moderationCasesResponseSchema.parse(await response.json());
};

export const findModerationCase = async (caseId: string): Promise<ModerationCaseDetail> => {
  const response = await apiRequest(`/moderation/cases/${caseId}`);
  return moderationCaseDetailSchema.parse(await response.json());
};

export const startModerationReview = async (caseId: string): Promise<ModerationCaseDetail> => {
  const response = await apiRequest(`/moderation/cases/${caseId}/start-review`, {
    method: 'POST',
    headers: { 'x-csrf-token': await getCsrfToken() },
  });
  return moderationCaseDetailSchema.parse(await response.json());
};

export const resolveModerationCase = async (
  caseId: string,
  action: ModerationDecisionAction,
  internalNote?: string,
): Promise<ModerationCaseDetail> => {
  const response = await apiRequest(`/moderation/cases/${caseId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await getCsrfToken() },
    body: JSON.stringify({ action, ...(internalNote ? { internalNote } : {}) }),
  });
  return moderationCaseDetailSchema.parse(await response.json());
};
