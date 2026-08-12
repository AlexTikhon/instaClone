import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilePage } from './profile-page';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  findProfile: vi.fn(),
  listPosts: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../entities/messaging/api', () => ({
  createConversation: mocks.createConversation,
}));
vi.mock('../../entities/post/api', () => ({ listPosts: mocks.listPosts }));
vi.mock('../../entities/user/api', () => ({
  findProfile: mocks.findProfile,
  followProfile: vi.fn(),
  unfollowProfile: vi.fn(),
}));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: '10000000-0000-4000-8000-000000000001' } }),
}));
vi.mock('../search/use-search-users', () => ({
  normalizeSearchQuery: (value: string) => value.trim().toLowerCase(),
  useSearchUsers: () => ({
    data: { pages: [{ users: [{ username: 'maya', relationship: 'none' }] }] },
  }),
}));

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ProfilePage username="maya" />, { wrapper });
};

describe('ProfilePage messaging action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProfile.mockResolvedValue({
      userId: '10000000-0000-4000-8000-000000000002',
      username: 'maya',
      displayName: 'Maya',
      bio: '',
      websiteUrl: null,
      isPrivate: false,
    });
    mocks.listPosts.mockResolvedValue({ posts: [], nextCursor: null });
    mocks.createConversation.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000010',
    });
  });

  it('creates or reuses a conversation and navigates to the thread', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Message' }));
    await waitFor(() =>
      expect(mocks.createConversation).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002'),
    );
    expect(mocks.push).toHaveBeenCalledWith('/messages/10000000-0000-4000-8000-000000000010');
  });
});
