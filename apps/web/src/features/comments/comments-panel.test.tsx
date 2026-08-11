import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { CommentsPanel } from './comments-panel';

const api = vi.hoisted(() => ({
  getComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
}));
vi.mock('../../entities/engagement/api', () => api);

describe('CommentsPanel', () => {
  it('loads comments and submits a trimmed new comment', async () => {
    api.getComments.mockResolvedValue({ comments: [], nextCursor: null, hasMore: false });
    api.createComment.mockResolvedValue({ id: 'comment' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommentsPanel postId="10000000-0000-4000-8000-000000000001" />
      </QueryClientProvider>,
    );
    await screen.findByText('No comments yet.');
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: ' hello ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() =>
      expect(api.createComment).toHaveBeenCalledWith(
        '10000000-0000-4000-8000-000000000001',
        'hello',
      ),
    );
  });
});
