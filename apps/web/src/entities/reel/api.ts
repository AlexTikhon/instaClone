import {
  reelResponseSchema,
  reelsResponseSchema,
  type CreateReelInput,
  type ReelResponse,
  type ReelsResponse,
} from '@instaclone/api-contracts';

import { apiRequest } from '../../shared/api/http-client';

export const createReel = async (
  input: CreateReelInput,
  csrfToken: string,
): Promise<ReelResponse> => {
  const response = await apiRequest('/reels', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return reelResponseSchema.parse(await response.json());
};

export const getReels = async (cursor?: string): Promise<ReelsResponse> => {
  const query = new URLSearchParams({ limit: '10' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/reels?${query.toString()}`);
  return reelsResponseSchema.parse(await response.json());
};
