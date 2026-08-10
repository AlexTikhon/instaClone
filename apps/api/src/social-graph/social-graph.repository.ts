import type {
  AcceptRequestResult,
  BlockResult,
  FollowResult,
  IncomingFollowRequest,
} from './social-graph.types';

export const SOCIAL_GRAPH_REPOSITORY = Symbol('SOCIAL_GRAPH_REPOSITORY');

export interface SocialGraphRepository {
  follow(actorId: string, targetId: string): Promise<FollowResult>;
  unfollow(actorId: string, targetId: string): Promise<void>;
  listIncomingRequests(targetId: string): Promise<IncomingFollowRequest[]>;
  acceptRequest(targetId: string, requesterId: string): Promise<AcceptRequestResult>;
  declineRequest(targetId: string, requesterId: string): Promise<boolean>;
  block(actorId: string, targetId: string): Promise<BlockResult>;
  unblock(actorId: string, targetId: string): Promise<void>;
}
