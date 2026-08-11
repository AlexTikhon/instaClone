import { feedResponseSchema, type FeedResponse } from '@instaclone/api-contracts';

import { apiRequest } from '../../shared/api/http-client';

export const getFeed = async (cursor?: string): Promise<FeedResponse> => {
  const query = new URLSearchParams({ limit: '10' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/feed?${query.toString()}`);
  return feedResponseSchema.parse(await response.json());
};
