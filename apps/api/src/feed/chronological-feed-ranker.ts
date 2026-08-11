import { Injectable } from '@nestjs/common';

import type { FeedCandidate, FeedRanker } from './feed-ranker';

@Injectable()
export class ChronologicalFeedRanker<
  TCandidate extends FeedCandidate = FeedCandidate,
> implements FeedRanker<TCandidate> {
  rank(_viewerId: string, candidates: TCandidate[]): TCandidate[] {
    return [...candidates].sort((left, right) => {
      const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
      return timeDifference === 0 ? right.id.localeCompare(left.id) : timeDifference;
    });
  }
}
