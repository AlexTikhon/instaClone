import { describe, expect, it } from 'vitest';

import {
  createReportInputSchema,
  moderationCasesQuerySchema,
  resolveModerationCaseInputSchema,
} from './moderation-contracts';

describe('moderation contracts', () => {
  it('accepts a bounded strict report command', () => {
    expect(
      createReportInputSchema.parse({
        targetType: 'POST',
        targetId: '10000000-0000-4000-8000-000000000001',
        reason: 'SPAM',
        details: 'Synthetic detail',
      }),
    ).toMatchObject({ targetType: 'POST', reason: 'SPAM' });
    expect(() =>
      createReportInputSchema.parse({
        targetType: 'POST',
        targetId: '10000000-0000-4000-8000-000000000001',
        reason: 'SPAM',
        details: 'x'.repeat(1_001),
      }),
    ).toThrow();
  });

  it('bounds case pages and private notes', () => {
    expect(moderationCasesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(() => moderationCasesQuerySchema.parse({ limit: '51' })).toThrow();
    expect(() =>
      resolveModerationCaseInputSchema.parse({
        action: 'NO_ACTION',
        internalNote: 'x'.repeat(2_001),
      }),
    ).toThrow();
  });
});
