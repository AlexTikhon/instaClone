import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomeFeed } from './home-feed';

const feed = vi.hoisted(() => ({ useFeed: vi.fn() }));
vi.mock('./use-feed', () => ({ useFeed: feed.useFeed }));

describe('HomeFeed', () => {
  it('renders loading and empty states', () => {
    feed.useFeed.mockReturnValue({ isPending: true });
    const { rerender } = render(<HomeFeed />);
    expect(screen.getByLabelText('Home feed')).toHaveAttribute('aria-busy', 'true');
    feed.useFeed.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [{ items: [] }] },
    });
    rerender(<HomeFeed />);
    expect(screen.getByText('Your feed is empty.')).toBeInTheDocument();
  });

  it('renders a retryable error state', () => {
    const refetch = vi.fn();
    feed.useFeed.mockReturnValue({ isPending: false, isError: true, refetch });
    render(<HomeFeed />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
