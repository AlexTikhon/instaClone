import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FeedResponse } from '@instaclone/api-contracts';

import { queryKeys } from './query-keys';
import { useLikePost } from './use-engagement-mutations';

const api = vi.hoisted(() => ({ setPostLiked: vi.fn(), setPostSaved: vi.fn() }));
vi.mock('../../entities/engagement/api', () => api);

const postId = '10000000-0000-4000-8000-000000000001';
const feedPage: FeedResponse = {
  items: [
    {
      post: {
        id: postId,
        author: {
          userId: '10000000-0000-4000-8000-000000000002',
          username: 'ada',
          displayName: 'Ada',
          bio: '',
          websiteUrl: null,
          isPrivate: false,
        },
        caption: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: [],
      },
      engagement: {
        likeCount: 0,
        commentCount: 0,
        viewerHasLiked: false,
        viewerHasSaved: false,
      },
    },
  ],
  nextCursor: null,
  hasMore: false,
};

describe('optimistic like', () => {
  it('updates immediately and rolls back exactly when the request fails', async () => {
    let rejectRequest: (error: Error) => void = () => undefined;
    api.setPostLiked.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData<InfiniteData<FeedResponse, string | undefined>>(queryKeys.feed, {
      pages: [feedPage],
      pageParams: [undefined],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLikePost(postId), { wrapper });
    act(() => result.current.mutate(true));
    await waitFor(() => {
      const current = client.getQueryData<InfiniteData<FeedResponse>>(queryKeys.feed);
      expect(current?.pages[0]?.items[0]?.engagement).toMatchObject({
        likeCount: 1,
        viewerHasLiked: true,
      });
    });
    act(() => rejectRequest(new Error('offline')));
    await waitFor(() => {
      const current = client.getQueryData<InfiniteData<FeedResponse>>(queryKeys.feed);
      expect(current?.pages[0]?.items[0]?.engagement).toMatchObject({
        likeCount: 0,
        viewerHasLiked: false,
      });
    });
  });
});
