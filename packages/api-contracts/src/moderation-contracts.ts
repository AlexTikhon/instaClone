import { z } from 'zod';

export const MAX_REPORT_DETAILS_LENGTH = 1_000;
export const MAX_MODERATOR_NOTE_LENGTH = 2_000;

export const moderationTargetTypeSchema = z.enum(['USER', 'POST', 'COMMENT', 'STORY', 'REEL']);
export const reportReasonSchema = z.enum([
  'SPAM',
  'HARASSMENT',
  'HATE_OR_ABUSE',
  'SEXUAL_CONTENT',
  'VIOLENCE',
  'IMPERSONATION',
  'SCAM',
  'OTHER',
]);
export const moderationCaseStatusSchema = z.enum(['OPEN', 'IN_REVIEW', 'CLOSED']);
export const moderationDecisionActionSchema = z.enum([
  'NO_ACTION',
  'REMOVE_CONTENT',
  'SUSPEND_ACCOUNT',
]);
export const moderationAuditActionSchema = z.enum([
  'START_REVIEW',
  'NO_ACTION',
  'REMOVE_CONTENT',
  'SUSPEND_ACCOUNT',
]);
export const moderationCaseIdSchema = z.uuid();

export const createReportInputSchema = z.strictObject({
  targetType: moderationTargetTypeSchema,
  targetId: z.uuid(),
  reason: reportReasonSchema,
  details: z.string().trim().min(1).max(MAX_REPORT_DETAILS_LENGTH).optional(),
});

export const createReportResponseSchema = z.strictObject({
  reportId: z.uuid(),
  status: z.literal('RECEIVED'),
});

export const moderationCasesQuerySchema = z.strictObject({
  status: moderationCaseStatusSchema.optional(),
  targetType: moderationTargetTypeSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const moderationCaseSummarySchema = z.strictObject({
  id: z.uuid(),
  targetType: moderationTargetTypeSchema,
  targetId: z.uuid(),
  status: moderationCaseStatusSchema,
  reportCount: z.number().int().positive(),
  reviewerId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});

export const moderationCasesResponseSchema = z.strictObject({
  cases: z.array(moderationCaseSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const moderationReportSchema = z.strictObject({
  id: z.uuid(),
  reporterId: z.uuid(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  snapshot: z.strictObject({
    text: z.string().nullable(),
    username: z.string(),
    ownerId: z.uuid(),
    mediaAssetIds: z.array(z.uuid()).max(10),
  }),
  createdAt: z.iso.datetime(),
});

export const moderationDecisionSchema = z.strictObject({
  action: moderationDecisionActionSchema,
  actorUserId: z.uuid(),
  internalNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const moderationAuditEntrySchema = z.strictObject({
  id: z.uuid(),
  actorUserId: z.uuid(),
  action: moderationAuditActionSchema,
  createdAt: z.iso.datetime(),
});

export const moderationCaseDetailSchema = moderationCaseSummarySchema.extend({
  reports: z.array(moderationReportSchema).max(50),
  reportsTruncated: z.boolean(),
  decision: moderationDecisionSchema.nullable(),
  audit: z.array(moderationAuditEntrySchema),
});

export const resolveModerationCaseInputSchema = z.strictObject({
  action: moderationDecisionActionSchema,
  internalNote: z.string().trim().min(1).max(MAX_MODERATOR_NOTE_LENGTH).optional(),
});

export type ModerationTargetType = z.infer<typeof moderationTargetTypeSchema>;
export type ReportReason = z.infer<typeof reportReasonSchema>;
export type ModerationCaseStatus = z.infer<typeof moderationCaseStatusSchema>;
export type ModerationDecisionAction = z.infer<typeof moderationDecisionActionSchema>;
export type CreateReportInput = z.infer<typeof createReportInputSchema>;
export type CreateReportResponse = z.infer<typeof createReportResponseSchema>;
export type ModerationCasesQuery = z.infer<typeof moderationCasesQuerySchema>;
export type ModerationCaseSummary = z.infer<typeof moderationCaseSummarySchema>;
export type ModerationCasesResponse = z.infer<typeof moderationCasesResponseSchema>;
export type ModerationCaseDetail = z.infer<typeof moderationCaseDetailSchema>;
export type ResolveModerationCaseInput = z.infer<typeof resolveModerationCaseInputSchema>;
