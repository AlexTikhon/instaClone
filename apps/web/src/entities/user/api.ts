import {
  profileSchema,
  socialConnectionResponseSchema,
  type Profile,
  type SocialConnectionResponse,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import { apiRequest } from '../../shared/api/http-client';

export const findProfile = async (username: string): Promise<Profile> => {
  const response = await apiRequest(
    `/profiles/${encodeURIComponent(username.trim().toLowerCase())}`,
  );
  return profileSchema.parse(await response.json());
};

export const followProfile = async (userId: string): Promise<SocialConnectionResponse> => {
  const response = await apiRequest(`/social/follows/${userId}`, {
    method: 'POST',
    headers: { 'x-csrf-token': await getCsrfToken() },
  });
  return socialConnectionResponseSchema.parse(await response.json());
};
