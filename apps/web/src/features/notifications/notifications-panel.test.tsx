import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsPanel } from './notifications-panel';

const mutations = vi.hoisted(() => ({
  markRead: { mutate: vi.fn(), isPending: false, variables: undefined },
  markAll: { mutate: vi.fn(), isPending: false },
}));
vi.mock('./use-notification-mutations', () => ({
  useMarkNotificationRead: () => mutations.markRead,
  useMarkAllNotificationsRead: () => mutations.markAll,
}));

const item = {
  id: '10000000-0000-4000-8000-000000000001',
  type: 'COMMENT' as const,
  createdAt: new Date().toISOString(),
  readAt: null,
  actor: {
    id: '10000000-0000-4000-8000-000000000002',
    username: 'maya',
    displayName: 'Maya',
    isAvailable: true,
  },
  target: {
    postId: '10000000-0000-4000-8000-000000000003',
    commentId: '10000000-0000-4000-8000-000000000004',
    contentAvailable: true,
  },
};

const query = (overrides: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: [item], unreadCount: 1, nextCursor: null, hasMore: false }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  }) as never;

describe('NotificationsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders loading, empty, and retryable error states', () => {
    const { rerender } = render(<NotificationsPanel notifications={query({ isPending: true })} />);
    expect(screen.getByText('Loading notifications…')).toBeInTheDocument();
    rerender(
      <NotificationsPanel
        notifications={query({ data: { pages: [{ items: [], unreadCount: 0 }] } })}
      />,
    );
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
    const refetch = vi.fn();
    rerender(<NotificationsPanel notifications={query({ isError: true, refetch })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders activity and invokes idempotent read controls', () => {
    render(<NotificationsPanel notifications={query()} />);
    fireEvent.click(screen.getByRole('button', { name: /@maya commented on your post/i }));
    expect(mutations.markRead.mutate).toHaveBeenCalledWith(item.id);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mutations.markAll.mutate).toHaveBeenCalledOnce();
  });
});
