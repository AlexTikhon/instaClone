import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModerationCasePage } from './moderation-case-page';

const api = vi.hoisted(() => ({ find: vi.fn(), start: vi.fn(), resolve: vi.fn() }));
vi.mock('../../entities/moderation/api', () => ({
  findModerationCase: api.find,
  startModerationReview: api.start,
  resolveModerationCase: api.resolve,
}));
vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({ user: { role: 'MODERATOR' } }),
}));

const detail = {
  id: '10000000-0000-4000-8000-000000000001',
  targetType: 'POST',
  targetId: '20000000-0000-4000-8000-000000000001',
  status: 'IN_REVIEW',
  reportCount: 1,
  reviewerId: '30000000-0000-4000-8000-000000000001',
  createdAt: '2026-08-12T12:00:00.000Z',
  updatedAt: '2026-08-12T12:01:00.000Z',
  closedAt: null,
  reports: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      reporterId: '50000000-0000-4000-8000-000000000001',
      reason: 'SPAM',
      details: 'Synthetic report detail',
      snapshot: {
        text: 'Synthetic caption',
        username: 'reported_user',
        ownerId: '60000000-0000-4000-8000-000000000001',
        mediaAssetIds: [],
      },
      createdAt: '2026-08-12T12:00:00.000Z',
    },
  ],
  reportsTruncated: false,
  decision: null,
  audit: [],
} as const;

describe('ModerationCasePage', () => {
  beforeEach(() => {
    api.find.mockReset().mockResolvedValue(detail);
    api.start.mockReset();
    api.resolve.mockReset().mockResolvedValue({ ...detail, status: 'CLOSED' });
  });

  it('shows privileged evidence and submits a bounded content decision', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ModerationCasePage caseId={detail.id} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Synthetic caption')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'REMOVE_CONTENT' } });
    fireEvent.change(screen.getByLabelText('Private note (optional)'), {
      target: { value: 'Policy-reviewed synthetic note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve case' }));
    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith(
        detail.id,
        'REMOVE_CONTENT',
        'Policy-reviewed synthetic note',
      ),
    );
  });
});
