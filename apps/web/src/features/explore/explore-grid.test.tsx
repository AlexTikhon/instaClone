import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExploreGrid } from './explore-grid';

const hook = vi.hoisted(() => ({ useExplore: vi.fn() }));
vi.mock('./use-explore', () => ({ useExplore: hook.useExplore }));

describe('ExploreGrid', () => {
  it('renders the grid and requests the next cursor page', () => {
    const fetchNextPage = vi.fn();
    hook.useExplore.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [
          {
            items: [
              {
                post: {
                  id: '10000000-0000-4000-8000-000000000001',
                  caption: 'Sunset',
                  author: { username: 'alex' },
                  media: [
                    {
                      url: 'https://media.example/image.jpg',
                      width: 640,
                      height: 480,
                    },
                  ],
                },
                engagement: { likeCount: 4, commentCount: 2 },
              },
            ],
          },
        ],
      },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });
    render(<ExploreGrid />);
    expect(screen.getByRole('img', { name: 'Sunset' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});
