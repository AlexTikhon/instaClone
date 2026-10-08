import { act, render, screen, waitFor } from '@testing-library/react';
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser, FeedResponse } from '@instaclone/api-contracts';

import { AuthProvider, useAuth } from '../features/auth/auth-provider';
import { queryKeys } from '../features/feed/query-keys';
import { useLikePost } from '../features/feed/use-engagement-mutations';
import { useFeed } from '../features/feed/use-feed';
import { messagingKeys } from '../features/messaging/query-keys';
import { useConversations } from '../features/messaging/use-messaging';
import { useNotifications } from '../features/notifications/use-notifications';
import { QueryProvider } from './query-provider';

const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getFeed: vi.fn(),
  getConversations: vi.fn(),
  getNotifications: vi.fn(),
  setPostLiked: vi.fn(),
}));
vi.mock('../lib/identity-api', () => ({
  getCsrfToken: vi.fn(),
  getCurrentUser: api.getCurrentUser,
  refreshSession: vi.fn(),
}));
vi.mock('../entities/feed/api', () => ({ getFeed: api.getFeed }));
vi.mock('../entities/messaging/api', () => ({
  getConversation: vi.fn(),
  getConversations: api.getConversations,
  getMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('../entities/notification/api', () => ({
  getNotifications: api.getNotifications,
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock('../entities/engagement/api', () => ({
  setPostLiked: api.setPostLiked,
  setPostSaved: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

type FeedCache = InfiniteData<FeedResponse, string | undefined>;

const postId = '10000000-0000-4000-8000-000000000001';

const userOf = (id: string, username: string): AuthenticatedUser => ({
  id,
  email: `${username}@example.com`,
  emailVerified: true,
  role: 'USER',
  profile: {
    userId: id,
    username,
    displayName: username,
    bio: '',
    websiteUrl: null,
    isPrivate: false,
  },
});

const userA = userOf('20000000-0000-4000-8000-00000000000a', 'alice');
const userB = userOf('20000000-0000-4000-8000-00000000000b', 'bob');

const feedPage = (marker: string, likeCount = 0): FeedResponse =>
  ({
    items: [{ post: { id: postId, caption: marker }, engagement: { likeCount } }],
    nextCursor: null,
    hasMore: false,
  }) as unknown as FeedResponse;

// Handles to live hook values, refreshed after every commit so tests can drive the session.
const handles = {} as {
  auth: ReturnType<typeof useAuth>;
  client: QueryClient;
  like: ReturnType<typeof useLikePost>;
};
let renders: string[] = [];

const flush = (action: () => void) =>
  act(async () => {
    action();
    await Promise.resolve();
  });

function Controls() {
  const value = useAuth();
  useEffect(() => {
    handles.auth = value;
  });
  return null;
}

// Mirrors AppShell: private content only mounts for an authenticated viewer.
function SignedInOnly({ children }: { children: ReactNode }) {
  return useAuth().user ? children : null;
}

function PrivateContent() {
  const queryClient = useQueryClient();
  useEffect(() => {
    handles.client = queryClient;
  });
  const feed = useFeed();
  const conversations = useConversations();
  const notifications = useNotifications();
  const text = JSON.stringify({
    feed: feed.data?.pages,
    conversations: conversations.data?.pages,
    notifications: notifications.data?.pages,
  });
  renders.push(text);
  return (
    <>
      <p data-testid="feed">{JSON.stringify(feed.data?.pages ?? null)}</p>
      <p data-testid="conversations">{JSON.stringify(conversations.data?.pages ?? null)}</p>
      <p data-testid="notifications">{JSON.stringify(notifications.data?.pages ?? null)}</p>
    </>
  );
}

function LikeProbe() {
  const mutation = useLikePost(postId);
  useEffect(() => {
    handles.like = mutation;
  });
  return null;
}

const renderApp = (children = <PrivateContent />, strict = false) => {
  const tree = (
    <AuthProvider>
      <Controls />
      <QueryProvider>
        <SignedInOnly>{children}</SignedInOnly>
      </QueryProvider>
    </AuthProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

const privateData = (viewer: string) => {
  api.getFeed.mockResolvedValue(feedPage(`feed-${viewer}`));
  api.getConversations.mockResolvedValue({
    conversations: [{ id: `conversation-${viewer}` }],
    nextCursor: null,
    hasMore: false,
  });
  api.getNotifications.mockResolvedValue({
    notifications: [{ id: `notification-${viewer}` }],
    unreadCount: 1,
    nextCursor: null,
    hasMore: false,
  });
};

const feedOf = (client: QueryClient) => client.getQueryData<FeedCache>(queryKeys.feed);
const likeCountOf = (client: QueryClient) =>
  feedOf(client)?.pages[0]?.items[0]?.engagement.likeCount ?? null;

describe('QueryProvider authentication sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renders = [];
    api.getCurrentUser.mockResolvedValue(userA);
    privateData('A');
  });

  it('never renders account A private data for logout or for account B, even briefly', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('-A'));
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-A');
    expect(screen.getByTestId('conversations')).toHaveTextContent('conversation-A');
    const clientOfA = handles.client;

    privateData('B');
    const bFeed = deferred<FeedResponse>();
    api.getFeed.mockReturnValue(bFeed.promise);
    renders = [];

    act(() => handles.auth.setUser(null));
    expect(document.body).not.toHaveTextContent('-A');
    act(() => handles.auth.setUser(userB));
    expect(document.body).not.toHaveTextContent('-A');
    expect(handles.client).not.toBe(clientOfA);

    await flush(() => bFeed.resolve(feedPage('feed-B')));
    await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('-B'));
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-B');
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.some((text) => text.includes('-A'))).toBe(false);
  });

  it('discards the old cache and aborts an in-flight query when the account changes', async () => {
    const aFeed = deferred<FeedResponse>();
    let aSignal: AbortSignal | undefined;
    api.getFeed.mockImplementationOnce((_cursor: unknown, signal?: AbortSignal) => {
      aSignal = signal;
      return aFeed.promise;
    });
    renderApp();
    await waitFor(() => expect(api.getFeed).toHaveBeenCalledTimes(1));
    const clientOfA = handles.client;

    privateData('B');
    act(() => handles.auth.setUser(userB));
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-B'));
    expect(aSignal?.aborted).toBe(true);

    // A's request settles late; B's cache and UI must be untouched.
    await flush(() => aFeed.resolve(feedPage('feed-A')));
    expect(feedOf(handles.client)?.pages[0]).toEqual(feedPage('feed-B'));
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-B');
    expect(document.body).not.toHaveTextContent('feed-A');
    expect(renders.some((text) => text.includes('feed-A'))).toBe(false);
    expect(handles.client).not.toBe(clientOfA);
    expect(clientOfA.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each([
    ['success', (request: Deferred<unknown>) => request.resolve({ liked: true, likeCount: 99 })],
    ['failure and rollback', (request: Deferred<unknown>) => request.reject(new Error('late'))],
  ])('ignores an account A mutation %s after the account changed', async (_name, settle) => {
    api.getFeed.mockResolvedValue(feedPage('feed-A', 0));
    renderApp(
      <>
        <PrivateContent />
        <LikeProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-A'));
    const request = deferred<unknown>();
    api.setPostLiked.mockReturnValue(request.promise);
    act(() => handles.like.mutate(true));
    await waitFor(() => expect(api.setPostLiked).toHaveBeenCalledOnce());

    api.getFeed.mockResolvedValue(feedPage('feed-B', 5));
    act(() => handles.auth.setUser(userB));
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-B'));
    const clientOfB = handles.client;
    expect(likeCountOf(clientOfB)).toBe(5);

    await flush(() => settle(request));
    expect(likeCountOf(clientOfB)).toBe(5);
    expect(feedOf(clientOfB)?.pages[0]).toEqual(feedPage('feed-B', 5));
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-B');
  });

  it('keeps the same client and cache when the same account updates its profile', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('-A'));
    const client = handles.client;
    renders = [];

    act(() =>
      handles.auth.setUser({
        ...userA,
        profile: { ...userA.profile, displayName: 'Alice Updated' },
      }),
    );

    expect(handles.client).toBe(client);
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-A');
    expect(client.getQueryData(messagingKeys.conversations())).toBeDefined();
    expect(renders.every((text) => text.includes('feed-A'))).toBe(true);
    expect(api.getFeed).toHaveBeenCalledTimes(1);
  });

  it('gives the same account a fresh client after logging out and back in', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-A'));
    const first = handles.client;
    act(() => handles.auth.setUser(null));
    act(() => handles.auth.setUser(userA));
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-A'));
    expect(handles.client).not.toBe(first);
    expect(api.getFeed).toHaveBeenCalledTimes(2);
  });

  it('survives StrictMode without discarding the live session cache', async () => {
    renderApp(<PrivateContent />, true);
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-A'));
    const client = handles.client;
    const fetches = api.getFeed.mock.calls.length;
    act(() =>
      handles.auth.setUser({
        ...userA,
        profile: { ...userA.profile, displayName: 'Alice Updated' },
      }),
    );
    expect(handles.client).toBe(client);
    expect(screen.getByTestId('feed')).toHaveTextContent('feed-A');
    expect(api.getFeed).toHaveBeenCalledTimes(fetches);

    privateData('B');
    act(() => handles.auth.setUser(userB));
    await waitFor(() => expect(screen.getByTestId('feed')).toHaveTextContent('feed-B'));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
