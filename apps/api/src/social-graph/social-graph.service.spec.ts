import type { Profile } from '@instaclone/api-contracts';

import type { SocialGraphRepository } from './social-graph.repository';
import { SocialGraphService } from './social-graph.service';
import type {
  AcceptRequestResult,
  BlockResult,
  FollowResult,
  IncomingFollowRequest,
} from './social-graph.types';

const pair = (first: string, second: string): string => `${first}:${second}`;

class InMemorySocialGraphRepository implements SocialGraphRepository {
  readonly profiles = new Map<string, Profile>();
  readonly follows = new Set<string>();
  readonly requests = new Map<string, Date>();
  readonly blocks = new Set<string>();

  follow(actorId: string, targetId: string): Promise<FollowResult> {
    if (actorId === targetId) return Promise.resolve('self');
    const target = this.profiles.get(targetId);
    if (!target) return Promise.resolve('not_found');
    if (this.hasBlock(actorId, targetId)) return Promise.resolve('blocked');
    if (this.follows.has(pair(actorId, targetId))) return Promise.resolve('following');
    if (target.isPrivate) {
      this.requests.set(pair(actorId, targetId), new Date());
      return Promise.resolve('requested');
    }
    this.follows.add(pair(actorId, targetId));
    return Promise.resolve('following');
  }

  unfollow(actorId: string, targetId: string): Promise<void> {
    this.follows.delete(pair(actorId, targetId));
    this.requests.delete(pair(actorId, targetId));
    return Promise.resolve();
  }

  listIncomingRequests(targetId: string): Promise<IncomingFollowRequest[]> {
    return Promise.resolve(
      [...this.requests.entries()].flatMap(([relationship, createdAt]) => {
        const [requesterId, requestTargetId] = relationship.split(':');
        const requester = requesterId ? this.profiles.get(requesterId) : undefined;
        return requestTargetId === targetId && requester ? [{ requester, createdAt }] : [];
      }),
    );
  }

  acceptRequest(targetId: string, requesterId: string): Promise<AcceptRequestResult> {
    const relationship = pair(requesterId, targetId);
    if (!this.requests.has(relationship)) return Promise.resolve('not_found');
    if (this.hasBlock(requesterId, targetId)) return Promise.resolve('blocked');
    this.requests.delete(relationship);
    this.follows.add(relationship);
    return Promise.resolve('following');
  }

  declineRequest(targetId: string, requesterId: string): Promise<boolean> {
    return Promise.resolve(this.requests.delete(pair(requesterId, targetId)));
  }

  block(actorId: string, targetId: string): Promise<BlockResult> {
    if (actorId === targetId) return Promise.resolve('self');
    if (!this.profiles.has(targetId)) return Promise.resolve('not_found');
    this.blocks.add(pair(actorId, targetId));
    this.removeBothDirections(this.follows, actorId, targetId);
    this.removeBothDirections(this.requests, actorId, targetId);
    return Promise.resolve('blocked');
  }

  unblock(actorId: string, targetId: string): Promise<void> {
    this.blocks.delete(pair(actorId, targetId));
    return Promise.resolve();
  }

  private hasBlock(first: string, second: string): boolean {
    return this.blocks.has(pair(first, second)) || this.blocks.has(pair(second, first));
  }

  private removeBothDirections(
    collection: Set<string> | Map<string, Date>,
    first: string,
    second: string,
  ): void {
    collection.delete(pair(first, second));
    collection.delete(pair(second, first));
  }
}

const profile = (userId: string, isPrivate = false): Profile => ({
  userId,
  username: `user_${userId}`,
  displayName: userId,
  bio: '',
  websiteUrl: null,
  isPrivate,
});

describe('SocialGraphService authorization rules', () => {
  let repository: InMemorySocialGraphRepository;
  let service: SocialGraphService;

  beforeEach(() => {
    repository = new InMemorySocialGraphRepository();
    repository.profiles.set('alice', profile('alice'));
    repository.profiles.set('bob', profile('bob'));
    repository.profiles.set('carol', profile('carol', true));
    service = new SocialGraphService(repository);
  });

  it('follows public users but requires private-account approval from the target', async () => {
    await expect(service.follow('alice', 'bob')).resolves.toEqual({ state: 'following' });
    await expect(service.follow('alice', 'carol')).resolves.toEqual({ state: 'requested' });
    await expect(service.acceptRequest('bob', 'alice')).rejects.toMatchObject({ status: 404 });
    await expect(service.incomingRequests('carol')).resolves.toMatchObject({
      requests: [{ requester: { userId: 'alice' } }],
    });
    await expect(service.acceptRequest('carol', 'alice')).resolves.toEqual({ state: 'following' });
    expect(repository.follows.has(pair('alice', 'carol'))).toBe(true);
  });

  it('removes both-direction relationships when blocking and hides the block state', async () => {
    await service.follow('alice', 'bob');
    await service.follow('bob', 'alice');
    await service.block('bob', 'alice');
    expect(repository.follows.size).toBe(0);
    await expect(service.follow('alice', 'bob')).rejects.toMatchObject({ status: 404 });
    await service.unblock('bob', 'alice');
    await expect(service.follow('alice', 'bob')).resolves.toEqual({ state: 'following' });
  });

  it('rejects self-directed mutations and only lets the target decline a request', async () => {
    await expect(service.follow('alice', 'alice')).rejects.toMatchObject({ status: 400 });
    await expect(service.block('alice', 'alice')).rejects.toMatchObject({ status: 400 });
    await service.follow('alice', 'carol');
    await expect(service.declineRequest('bob', 'alice')).rejects.toMatchObject({ status: 404 });
    await expect(service.declineRequest('carol', 'alice')).resolves.toBeUndefined();
  });
});
