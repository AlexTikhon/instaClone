'use client';

import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { StorySequenceResponse, StoryTrayResponse } from '@instaclone/api-contracts';

import {
  deleteStory,
  getStorySequence,
  getStoryTray,
  getStoryViewers,
  recordStoryView,
} from '../../entities/story/api';
import { getCsrfToken } from '../../lib/identity-api';
import { queryKeys } from '../feed/query-keys';

export const storyTrayQueryOptions = () =>
  queryOptions({ queryKey: queryKeys.stories, queryFn: getStoryTray });

export const storySequenceQueryOptions = (authorId: string) =>
  queryOptions({
    queryKey: queryKeys.storySequence(authorId),
    queryFn: () => getStorySequence(authorId),
  });

export const useStoryTray = () => useQuery(storyTrayQueryOptions());
export const useStorySequence = (authorId: string) =>
  useQuery({ ...storySequenceQueryOptions(authorId), enabled: authorId.length > 0 });

export const useRecordStoryView = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ storyId }: { storyId: string; authorId: string }) =>
      recordStoryView(storyId, await getCsrfToken()),
    onMutate: ({ storyId, authorId }) => {
      queryClient.setQueryData<StorySequenceResponse>(
        queryKeys.storySequence(authorId),
        (sequence) =>
          sequence
            ? {
                ...sequence,
                stories: sequence.stories.map((story) =>
                  story.id === storyId ? { ...story, viewerHasViewed: true } : story,
                ),
              }
            : sequence,
      );
      const sequence = queryClient.getQueryData<StorySequenceResponse>(
        queryKeys.storySequence(authorId),
      );
      const hasUnseen = sequence?.stories.some((story) => !story.viewerHasViewed) ?? false;
      queryClient.setQueryData<StoryTrayResponse>(queryKeys.stories, (tray) =>
        tray
          ? {
              groups: tray.groups.map((group) =>
                group.author.id === authorId ? { ...group, hasUnseenStories: hasUnseen } : group,
              ),
            }
          : tray,
      );
    },
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storySequence(variables.authorId) }),
      ]),
  });
};

export const useDeleteStory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ storyId }: { storyId: string; authorId: string }) =>
      deleteStory(storyId, await getCsrfToken()),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storySequence(variables.authorId) }),
      ]);
    },
  });
};

export const storyViewersQueryOptions = (storyId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.storyViewers(storyId),
    queryFn: ({ pageParam }) => getStoryViewers(storyId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  });

export const useStoryViewers = (storyId: string, enabled: boolean) =>
  useInfiniteQuery({ ...storyViewersQueryOptions(storyId), enabled });
