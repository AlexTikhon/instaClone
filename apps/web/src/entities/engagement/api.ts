import {
  commentResponseSchema,
  commentsResponseSchema,
  likeResponseSchema,
  saveResponseSchema,
  type CommentResponse,
  type CommentsResponse,
  type LikeResponse,
  type SaveResponse,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import { apiRequest } from '../../shared/api/http-client';

const csrfMutation = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => {
  const csrfToken = await getCsrfToken();
  return apiRequest(path, {
    method,
    headers: {
      'x-csrf-token': csrfToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

export const setPostLiked = async (postId: string, liked: boolean): Promise<LikeResponse> => {
  const response = await csrfMutation(`/posts/${postId}/like`, liked ? 'PUT' : 'DELETE');
  return likeResponseSchema.parse(await response.json());
};

export const setPostSaved = async (postId: string, saved: boolean): Promise<SaveResponse> => {
  const response = await csrfMutation(`/posts/${postId}/save`, saved ? 'PUT' : 'DELETE');
  return saveResponseSchema.parse(await response.json());
};

export const getComments = async (postId: string, cursor?: string): Promise<CommentsResponse> => {
  const query = new URLSearchParams({ limit: '10' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/posts/${postId}/comments?${query.toString()}`);
  return commentsResponseSchema.parse(await response.json());
};

export const createComment = async (postId: string, body: string): Promise<CommentResponse> => {
  const response = await csrfMutation(`/posts/${postId}/comments`, 'POST', { body });
  return commentResponseSchema.parse(await response.json());
};

export const deleteComment = async (commentId: string): Promise<void> => {
  await csrfMutation(`/comments/${commentId}`, 'DELETE');
};
