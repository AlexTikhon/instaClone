import { Injectable } from '@nestjs/common';

import type {
  ModerationCaseStatus,
  ModerationDecisionAction,
  ModerationTargetType,
} from '@instaclone/api-contracts';

export class InvalidModerationTransitionError extends Error {}
export class InvalidModerationActionError extends Error {}

@Injectable()
export class ModerationPolicy {
  assertTransition(from: ModerationCaseStatus, to: ModerationCaseStatus): void {
    const valid =
      (from === 'OPEN' && (to === 'IN_REVIEW' || to === 'CLOSED')) ||
      (from === 'IN_REVIEW' && to === 'CLOSED');
    if (!valid) {
      throw new InvalidModerationTransitionError(`Invalid case transition: ${from} -> ${to}`);
    }
  }

  assertAction(
    targetType: ModerationTargetType,
    action: ModerationDecisionAction,
    actorRole: 'MODERATOR' | 'ADMIN',
  ): void {
    if (action === 'NO_ACTION') return;
    if (action === 'REMOVE_CONTENT' && targetType !== 'USER') return;
    if (action === 'SUSPEND_ACCOUNT' && targetType === 'USER' && actorRole === 'ADMIN') return;
    throw new InvalidModerationActionError(`${actorRole} cannot apply ${action} to ${targetType}`);
  }
}
