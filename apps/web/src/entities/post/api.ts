import {
  postResponseSchema,
  paginatedPostsResponseSchema,
  type CreatePostInput,
  type PaginatedPostsResponse,
  type PostResponse,
} from '@instaclone/api-contracts';

import { apiRequest } from '../../shared/api/http-client';

export const createPost = async (
  input: CreatePostInput,
  csrfToken: string,
): Promise<PostResponse> => {
  const response = await apiRequest('/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return postResponseSchema.parse(await response.json());
};

export const listPosts = async (
  authorId: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<PaginatedPostsResponse> => {
  const query = new URLSearchParams({ authorId, limit: '12' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/posts?${query.toString()}`, { signal });
  return paginatedPostsResponseSchema.parse(await response.json());
};
