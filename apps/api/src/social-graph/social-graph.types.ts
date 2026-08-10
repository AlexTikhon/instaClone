import type { Profile, SocialConnectionState } from '@instaclone/api-contracts';

export type FollowResult = SocialConnectionState | 'blocked' | 'not_found' | 'self';
export type AcceptRequestResult = 'following' | 'blocked' | 'not_found';
export type BlockResult = 'blocked' | 'not_found' | 'self';

export interface IncomingFollowRequest {
  requester: Profile;
  createdAt: Date;
}
