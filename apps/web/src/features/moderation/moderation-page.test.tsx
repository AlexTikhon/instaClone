import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModerationPage } from './moderation-page';

const mocks = vi.hoisted(() => ({ list: vi.fn(), role: 'MODERATOR'.toString() }));
vi.mock('../../entities/moderation/api', () => ({ listModerationCases: mocks.list }));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModerationPage />
    </QueryClientProvider>,
  );
};

describe('ModerationPage', () => {
  beforeEach(() => {
    mocks.role = 'MODERATOR';
    mocks.list.mockReset();
  });

  it('renders bounded case-list state for a moderator', async () => {
    mocks.list.mockResolvedValue({
      cases: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          targetType: 'POST',
          targetId: '20000000-0000-4000-8000-000000000001',
          status: 'IN_REVIEW',
          reportCount: 2,
          reviewerId: null,
          createdAt: '2026-08-12T12:00:00.000Z',
          updatedAt: '2026-08-12T12:00:00.000Z',
          closedAt: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('Moderation cases')).toBeInTheDocument();
    expect(screen.getByText('IN REVIEW')).toBeInTheDocument();
    expect(screen.getByText('2 reports')).toBeInTheDocument();
  });

  it('does not query or render cases for an ordinary user', () => {
    mocks.role = 'USER';
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Moderator access is required');
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
