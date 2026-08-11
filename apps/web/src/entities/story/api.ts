import {
  storyResponseSchema,
  storySequenceResponseSchema,
  storyTrayResponseSchema,
  storyViewersResponseSchema,
  storyViewResponseSchema,
  type CreateStoryInput,
  type StoryResponse,
  type StorySequenceResponse,
  type StoryTrayResponse,
  type StoryViewersResponse,
  type StoryViewResponse,
} from '@instaclone/api-contracts';

import { apiRequest } from '../../shared/api/http-client';

export const createStory = async (
  input: CreateStoryInput,
  csrfToken: string,
): Promise<StoryResponse> => {
  const response = await apiRequest('/stories', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return storyResponseSchema.parse(await response.json());
};

export const getStoryTray = async (): Promise<StoryTrayResponse> => {
  const response = await apiRequest('/stories');
  return storyTrayResponseSchema.parse(await response.json());
};

export const getStorySequence = async (authorId: string): Promise<StorySequenceResponse> => {
  const response = await apiRequest(`/stories/users/${authorId}`);
  return storySequenceResponseSchema.parse(await response.json());
};

export const recordStoryView = async (
  storyId: string,
  csrfToken: string,
): Promise<StoryViewResponse> => {
  const response = await apiRequest(`/stories/${storyId}/view`, {
    method: 'PUT',
    headers: { 'x-csrf-token': csrfToken },
  });
  return storyViewResponseSchema.parse(await response.json());
};

export const deleteStory = async (storyId: string, csrfToken: string): Promise<void> => {
  await apiRequest(`/stories/${storyId}`, {
    method: 'DELETE',
    headers: { 'x-csrf-token': csrfToken },
  });
};

export const getStoryViewers = async (
  storyId: string,
  cursor?: string,
): Promise<StoryViewersResponse> => {
  const query = new URLSearchParams({ limit: '25' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/stories/${storyId}/viewers?${query.toString()}`);
  return storyViewersResponseSchema.parse(await response.json());
};
