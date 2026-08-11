import type {
  AcceptRequestResult,
  BlockResult,
  FollowResult,
  IncomingFollowRequestPage,
  FollowRequestCursor,
} from './social-graph.types';

export const SOCIAL_GRAPH_REPOSITORY = Symbol('SOCIAL_GRAPH_REPOSITORY');

export interface SocialGraphRepository {
  follow(actorId: string, targetId: string, correlationId: string): Promise<FollowResult>;
  unfollow(actorId: string, targetId: string): Promise<void>;
  listIncomingRequests(
    targetId: string,
    limit: number,
    cursor: FollowRequestCursor | null,
  ): Promise<IncomingFollowRequestPage>;
  acceptRequest(targetId: string, requesterId: string): Promise<AcceptRequestResult>;
  declineRequest(targetId: string, requesterId: string): Promise<void>;
  block(actorId: string, targetId: string): Promise<BlockResult>;
  unblock(actorId: string, targetId: string): Promise<void>;
  canViewPosts(viewerId: string, authorId: string): Promise<boolean>;
}
