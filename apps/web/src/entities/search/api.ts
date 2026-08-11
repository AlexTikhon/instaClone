import {
  exploreResponseSchema,
  searchUsersResponseSchema,
  type ExploreResponse,
  type SearchUsersResponse,
} from '@instaclone/api-contracts';

import { apiRequest } from '../../shared/api/http-client';

export const searchUsers = async (
  queryText: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<SearchUsersResponse> => {
  const query = new URLSearchParams({ q: queryText, limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/search/users?${query.toString()}`, { signal });
  return searchUsersResponseSchema.parse(await response.json());
};

export const getExplore = async (
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ExploreResponse> => {
  const query = new URLSearchParams({ limit: '18' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/explore?${query.toString()}`, { signal });
  return exploreResponseSchema.parse(await response.json());
};
