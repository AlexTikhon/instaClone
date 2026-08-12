import { describe, expect, it } from 'vitest';

import {
  InvalidModerationActionError,
  InvalidModerationTransitionError,
  ModerationPolicy,
} from './moderation-policy';

describe('ModerationPolicy', () => {
  const policy = new ModerationPolicy();

  it.each([
    ['OPEN', 'IN_REVIEW'],
    ['OPEN', 'CLOSED'],
    ['IN_REVIEW', 'CLOSED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => policy.assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['OPEN', 'OPEN'],
    ['IN_REVIEW', 'OPEN'],
    ['IN_REVIEW', 'IN_REVIEW'],
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'IN_REVIEW'],
    ['CLOSED', 'CLOSED'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => policy.assertTransition(from, to)).toThrow(InvalidModerationTransitionError);
  });

  it('limits account suspension to administrators and user targets', () => {
    expect(() => policy.assertAction('USER', 'SUSPEND_ACCOUNT', 'ADMIN')).not.toThrow();
    expect(() => policy.assertAction('USER', 'SUSPEND_ACCOUNT', 'MODERATOR')).toThrow(
      InvalidModerationActionError,
    );
    expect(() => policy.assertAction('POST', 'SUSPEND_ACCOUNT', 'ADMIN')).toThrow(
      InvalidModerationActionError,
    );
  });
});
