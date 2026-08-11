export interface FeedCandidate {
  id: string;
  createdAt: Date;
}

export interface FeedRanker<TCandidate extends FeedCandidate = FeedCandidate> {
  rank(viewerId: string, candidates: TCandidate[]): TCandidate[];
}

export const FEED_RANKER = Symbol('FEED_RANKER');
