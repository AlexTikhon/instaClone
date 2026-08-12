import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessagingPage } from './messaging-page';

const hooks = vi.hoisted(() => ({
  conversations: vi.fn(),
  conversation: vi.fn(),
  messages: vi.fn(),
  send: { mutate: vi.fn() },
  read: { mutate: vi.fn() },
}));

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: '10000000-0000-4000-8000-000000000001' } }),
}));
vi.mock('./use-messaging', () => ({
  useConversations: hooks.conversations,
  useConversation: hooks.conversation,
  useMessages: hooks.messages,
  useSendMessage: () => hooks.send,
  useMarkConversationRead: () => hooks.read,
}));

const conversation = {
  id: '10000000-0000-4000-8000-000000000010',
  peer: {
    userId: '10000000-0000-4000-8000-000000000002',
    username: 'maya',
    displayName: 'Maya',
    isAvailable: true,
  },
  createdAt: '2026-08-12T10:00:00.000Z',
  lastActivityAt: '2026-08-12T10:01:00.000Z',
  lastMessage: null,
  unreadCount: 2,
  blocked: false,
};

const message = {
  id: '10000000-0000-4000-8000-000000000020',
  conversationId: conversation.id,
  senderId: conversation.peer.userId,
  sequence: 1,
  text: 'Hello from Maya',
  clientMessageId: '10000000-0000-4000-8000-000000000021',
  createdAt: '2026-08-12T10:01:00.000Z',
};

const conversationQuery = (overrides: Record<string, unknown> = {}) => ({
  isPending: false,
  isError: false,
  data: { pages: [{ items: [conversation], hasMore: false, nextCursor: null }] },
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  ...overrides,
});

const messagesQuery = (overrides: Record<string, unknown> = {}) => ({
  isPending: false,
  isError: false,
  data: { pages: [{ items: [message], hasMore: false, nextCursor: null }], pageParams: [] },
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('MessagingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.conversations.mockReturnValue(conversationQuery());
    hooks.conversation.mockReturnValue({ isPending: false, isError: false, data: conversation });
    hooks.messages.mockReturnValue(messagesQuery());
  });

  it('renders conversation unread state and the active message thread', () => {
    render(<MessagingPage conversationId={conversation.id} />);
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByText('Hello from Maya')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message Maya')).toBeInTheDocument();
  });

  it('sends with a stable client ID and exposes older-history loading', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    hooks.messages.mockReturnValue(messagesQuery({ hasNextPage: true, fetchNextPage }));
    render(<MessagingPage conversationId={conversation.id} />);
    fireEvent.change(screen.getByPlaceholderText('Message Maya'), {
      target: { value: 'A new message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const sent = hooks.send.mutate.mock.calls[0]?.[0] as
      { text: string; clientMessageId: string } | undefined;
    expect(sent?.text).toBe('A new message');
    expect(sent?.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('renders loading/empty list states and disables a blocked composer', () => {
    hooks.conversations.mockReturnValue(conversationQuery({ isPending: true }));
    const { rerender } = render(<MessagingPage />);
    expect(screen.getByText('Loading conversations…')).toBeInTheDocument();
    hooks.conversations.mockReturnValue(conversationQuery({ data: { pages: [{ items: [] }] } }));
    rerender(<MessagingPage />);
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();

    hooks.conversations.mockReturnValue(conversationQuery());
    hooks.conversation.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...conversation, blocked: true },
    });
    rerender(<MessagingPage conversationId={conversation.id} />);
    expect(screen.getByText(/Existing history remains visible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });
});
