import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

import { QueryProvider } from '../../app/query-provider';
import { AuthProvider, useAuth } from '../auth/auth-provider';
import { queryKeys } from '../feed/query-keys';
import type { NotificationsCache } from '../notifications/notification-cache';
import { useNotifications } from '../notifications/use-notifications';
import { IdentityPanel } from '../../components/identity-panel';
import { AppShell } from './app-shell';

const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getNotifications: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/activity' }));
vi.mock('../../lib/identity-api', () => ({
  getCsrfToken: vi.fn().mockResolvedValue('csrf'),
  getCurrentUser: api.getCurrentUser,
  login: vi.fn(),
  logout: api.logout,
  refreshSession: vi.fn(),
  register: vi.fn(),
  updateOwnProfile: vi.fn(),
}));
vi.mock('../../entities/notification/api', () => ({
  getNotifications: api.getNotifications,
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock('../create-post/create-post-form', () => ({ CreatePostForm: () => null }));
vi.mock('../create-story/create-story-form', () => ({ CreateStoryForm: () => null }));

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  emit(name: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
  }
}

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

const notification = (id: string) => ({
  id,
  type: 'LIKE' as const,
  createdAt: new Date().toISOString(),
  readAt: null,
  actor: { id: null, username: 'ada', displayName: 'Ada', isAvailable: true },
  target: { postId: null, commentId: null, contentAvailable: null },
});

const page = (id: string) => ({
  items: [notification(id)],
  nextCursor: null,
  hasMore: false,
  unreadCount: 1,
});

// Handles to live hook values, refreshed after every commit so the test can drive the session.
const handles = {} as { auth: ReturnType<typeof useAuth>; client: QueryClient };

function Controls() {
  const value = useAuth();
  useEffect(() => {
    handles.auth = value;
  });
  return null;
}

function PrivateNotifications() {
  const queryClient = useQueryClient();
  useEffect(() => {
    handles.client = queryClient;
  });
  const notifications = useNotifications();
  return <p data-testid="items">{JSON.stringify(notifications.data?.pages[0]?.items ?? [])}</p>;
}

describe('AppShell session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    api.getCurrentUser.mockResolvedValue(userA);
    api.logout.mockResolvedValue(undefined);
    api.getNotifications.mockResolvedValue(page('a-notification'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tears down account A realtime and cache on logout so account B starts clean', async () => {
    render(
      <AuthProvider>
        <Controls />
        <QueryProvider>
          <AppShell>
            <IdentityPanel />
            <PrivateNotifications />
          </AppShell>
        </QueryProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('a-notification'));
    const staleSocket = FakeWebSocket.instances[0]!;
    expect(FakeWebSocket.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.queryByTestId('items')).not.toBeInTheDocument());
    expect(staleSocket.closed).toBe(true);
    expect(document.body).not.toHaveTextContent('a-notification');

    api.getNotifications.mockResolvedValue({ ...page('b-notification'), unreadCount: 0 });
    act(() => handles.auth.setUser(userB));
    await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('b-notification'));
    const clientOfB = handles.client;
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.closed).toBe(false);

    // A's stale socket delivers late; B's cache and UI must not change.
    const lateId = crypto.randomUUID();
    act(() => {
      staleSocket.emit('message', {
        data: JSON.stringify({
          event: 'NOTIFICATION_CREATED',
          data: { notification: notification(lateId) },
        }),
      });
    });
    const cache = clientOfB.getQueryData<NotificationsCache>(queryKeys.notifications);
    expect(cache?.pages[0]?.items.map((item) => item.id)).toEqual([
      expect.stringContaining('b-notification'),
    ]);
    expect(document.body).not.toHaveTextContent(lateId);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
