import {
  postResponseSchema,
  type CreatePostInput,
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
