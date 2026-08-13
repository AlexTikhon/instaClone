import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoryResponse, StoryTrayResponse } from '@instaclone/api-contracts';

import { StoryTray } from './story-tray';

const api = vi.hoisted(() => ({
  deleteStory: vi.fn(),
  getStorySequence: vi.fn(),
  getStoryTray: vi.fn(),
  getStoryViewers: vi.fn(),
  recordStoryView: vi.fn(),
}));
vi.mock('../../entities/story/api', () => api);
vi.mock('../../lib/identity-api', () => ({ getCsrfToken: () => Promise.resolve('csrf') }));

const aliceId = '00000000-0000-4000-8000-000000000001';
const bobId = '00000000-0000-4000-8000-000000000002';
const aliceStoryId = '00000000-0000-4000-8000-000000000011';
const bobStoryId = '00000000-0000-4000-8000-000000000012';

const story = (id: string, authorId: string, displayName: string): StoryResponse => ({
  id,
  author: { id: authorId, username: displayName.toLowerCase(), displayName },
  media: {
    id: '00000000-0000-4000-8000-000000000099',
    kind: 'IMAGE',
    status: 'READY',
    declaredMimeType: 'image/jpeg',
    declaredSizeBytes: 100,
    verifiedSizeBytes: 100,
    width: 640,
    height: 800,
    durationMs: null,
    videoCodec: null,
    audioCodec: null,
    frameRate: null,
    rotationDegrees: null,
    failureCode: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
    url: 'https://media.example/story.jpg',
  },
  createdAt: '2026-08-11T10:00:00.000Z',
  expiresAt: '2026-08-12T10:00:00.000Z',
  viewerHasViewed: false,
});

const tray = (seen = false): StoryTrayResponse => ({
  groups: [
    {
      author: { id: aliceId, username: 'alice', displayName: 'Alice' },
      isViewer: false,
      hasUnseenStories: !seen,
      storyCount: 1,
      latestStoryAt: '2026-08-11T10:00:00.000Z',
    },
    {
      author: { id: bobId, username: 'bob', displayName: 'Bob' },
      isViewer: false,
      hasUnseenStories: true,
      storyCount: 1,
      latestStoryAt: '2026-08-11T09:00:00.000Z',
    },
  ],
});

const renderWithQuery = (node: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

describe('StoryTray', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStoryViewers.mockResolvedValue({ viewers: [], nextCursor: null, hasMore: false });
    api.recordStoryView.mockImplementation((storyId: string) =>
      Promise.resolve({ storyId, recorded: true, viewedAt: '2026-08-11T10:01:00.000Z' }),
    );
  });

  it('renders loading and empty tray states', async () => {
    let resolveTray: ((value: StoryTrayResponse) => void) | undefined;
    api.getStoryTray.mockReturnValue(
      new Promise<StoryTrayResponse>((resolve) => {
        resolveTray = resolve;
      }),
    );
    renderWithQuery(<StoryTray />);
    expect(screen.getByLabelText('Stories')).toHaveAttribute('aria-busy', 'true');
    resolveTray?.({ groups: [] });
    expect(await screen.findByText('No active Stories yet.')).toBeInTheDocument();
  });

  it('opens an unseen Story, records it once, optimistically marks it seen, and closes by keyboard', async () => {
    api.getStoryTray.mockResolvedValueOnce(tray()).mockResolvedValue(tray(true));
    api.getStorySequence.mockResolvedValue({
      author: tray().groups[0]!.author,
      stories: [story(aliceStoryId, aliceId, 'Alice')],
    });
    renderWithQuery(<StoryTray />);
    const alice = await screen.findByRole('button', { name: "View Alice's Stories" });
    expect(alice).toHaveClass('unseen');
    fireEvent.click(alice);
    expect(await screen.findByRole('dialog', { name: 'Story viewer' })).toBeInTheDocument();
    await waitFor(() => expect(api.recordStoryView).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(alice).toHaveClass('seen'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('moves next and previous across authors with buttons and arrow keys', async () => {
    api.getStoryTray.mockResolvedValue(tray());
    api.getStorySequence.mockImplementation((authorId: string) =>
      Promise.resolve(
        authorId === aliceId
          ? { author: tray().groups[0]!.author, stories: [story(aliceStoryId, aliceId, 'Alice')] }
          : { author: tray().groups[1]!.author, stories: [story(bobStoryId, bobId, 'Bob')] },
      ),
    );
    renderWithQuery(<StoryTray />);
    fireEvent.click(await screen.findByRole('button', { name: "View Alice's Stories" }));
    expect(await screen.findByText('@alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('@bob')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByText('@alice')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByText('@bob')).toBeInTheDocument();
  });
});
