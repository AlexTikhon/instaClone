import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchPage } from './search-page';

const mocks = vi.hoisted(() => ({
  follow: vi.fn(),
  replace: vi.fn(),
  search: vi.fn(),
  unfollow: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams('q=alex'),
}));
vi.mock('./use-debounced-value', () => ({ useDebouncedValue: (value: string) => value }));
vi.mock('./use-search-users', () => ({
  normalizeSearchQuery: (value: string) =>
    value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'),
  useSearchUsers: mocks.search,
}));
vi.mock('../../entities/user/api', () => ({
  followProfile: mocks.follow,
  unfollowProfile: mocks.unfollow,
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SearchPage />, { wrapper });
};

describe('SearchPage', () => {
  beforeEach(() => {
    mocks.follow.mockResolvedValue({ state: 'following' });
    mocks.unfollow.mockResolvedValue(undefined);
  });

  it('renders loading, error, and empty states', () => {
    mocks.search.mockReturnValue({ isPending: true });
    const view = renderPage();
    expect(screen.getByText('Searching…')).toBeInTheDocument();

    const refetch = vi.fn();
    mocks.search.mockReturnValue({ isPending: false, isError: true, refetch });
    view.rerender(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();

    mocks.search.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [{ users: [] }] },
    });
    view.rerender(<SearchPage />);
    expect(screen.getByText(/No people match/)).toBeInTheDocument();
  });

  it('renders results and invokes the existing follow mutation', async () => {
    mocks.search.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [
          {
            users: [
              {
                userId: '10000000-0000-4000-8000-000000000001',
                username: 'alex',
                displayName: 'Alex Rivera',
                isPrivate: false,
                relationship: 'none',
              },
            ],
          },
        ],
      },
      hasNextPage: false,
    });
    renderPage();
    expect(screen.getByText('@alex')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() =>
      expect(mocks.follow).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001'),
    );
  });
});
