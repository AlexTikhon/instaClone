import type { SearchRelationshipState } from '@instaclone/api-contracts';

export interface SearchUserCursor {
  query: string;
  rank: number;
  normalizedUsername: string;
  userId: string;
}

export interface SearchUserCandidate {
  userId: string;
  username: string;
  normalizedUsername: string;
  displayName: string;
  isPrivate: boolean;
  relationship: SearchRelationshipState;
  rank: number;
}

export interface ExploreCursor {
  snapshotAt: Date;
  score: number;
  createdAt: Date;
  postId: string;
}

export interface ExploreCandidate {
  postId: string;
  score: number;
  createdAt: Date;
  snapshotAt: Date;
}
