'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import type { FeedResponse } from '@instaclone/api-contracts';

import { setPostLiked, setPostSaved } from '../../entities/engagement/api';
import { queryKeys } from './query-keys';

type FeedCache = InfiniteData<FeedResponse, string | undefined>;

const patchFeed = (
  current: FeedCache | undefined,
  postId: string,
  patch: (
    engagement: FeedResponse['items'][number]['engagement'],
  ) => FeedResponse['items'][number]['engagement'],
): FeedCache | undefined =>
  current
    ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.post.id === postId ? { ...item, engagement: patch(item.engagement) } : item,
          ),
        })),
      }
    : current;

export const useLikePost = (postId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (liked: boolean) => setPostLiked(postId, liked),
    onMutate: async (liked) => {
      await client.cancelQueries({ queryKey: queryKeys.feed });
      const previous = client.getQueryData<FeedCache>(queryKeys.feed);
      client.setQueryData<FeedCache>(queryKeys.feed, (current) =>
        patchFeed(current, postId, (engagement) => {
          if (engagement.viewerHasLiked === liked) return engagement;
          return {
            ...engagement,
            viewerHasLiked: liked,
            likeCount: Math.max(0, engagement.likeCount + (liked ? 1 : -1)),
          };
        }),
      );
      return { previous };
    },
    onError: (_error, _liked, context) => {
      if (context?.previous) client.setQueryData(queryKeys.feed, context.previous);
    },
    onSuccess: (result) => {
      client.setQueryData<FeedCache>(queryKeys.feed, (current) =>
        patchFeed(current, postId, (engagement) => ({
          ...engagement,
          viewerHasLiked: result.liked,
          likeCount: result.likeCount,
        })),
      );
    },
  });
};

export const useSavePost = (postId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) => setPostSaved(postId, saved),
    onMutate: async (saved) => {
      await client.cancelQueries({ queryKey: queryKeys.feed });
      const previous = client.getQueryData<FeedCache>(queryKeys.feed);
      client.setQueryData<FeedCache>(queryKeys.feed, (current) =>
        patchFeed(current, postId, (engagement) => ({ ...engagement, viewerHasSaved: saved })),
      );
      return { previous };
    },
    onError: (_error, _saved, context) => {
      if (context?.previous) client.setQueryData(queryKeys.feed, context.previous);
    },
  });
};
