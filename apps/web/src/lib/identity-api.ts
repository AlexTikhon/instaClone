import {
  authResponseSchema,
  csrfResponseSchema,
  profileSchema,
  type AuthenticatedUser,
  type LoginInput,
  type RegisterInput,
  type UpdateProfileInput,
} from '@instaclone/api-contracts';
import { apiRequest } from '../shared/api/http-client';

export const getCsrfToken = async (): Promise<string> => {
  const response = await apiRequest('/auth/csrf');
  return csrfResponseSchema.parse(await response.json()).csrfToken;
};

const mutateAuth = async (
  path: string,
  csrfToken: string,
  body?: LoginInput | RegisterInput,
): Promise<AuthenticatedUser> => {
  const response = await apiRequest(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: body ? JSON.stringify(body) : undefined,
  });
  return authResponseSchema.parse(await response.json()).user;
};

export const register = (input: RegisterInput, csrfToken: string) =>
  mutateAuth('/auth/register', csrfToken, input);

export const login = (input: LoginInput, csrfToken: string) =>
  mutateAuth('/auth/login', csrfToken, input);

export const refreshSession = (csrfToken: string) => mutateAuth('/auth/refresh', csrfToken);

export const getCurrentUser = async (): Promise<AuthenticatedUser> => {
  const response = await apiRequest('/auth/me');
  return authResponseSchema.parse(await response.json()).user;
};

export const logout = async (csrfToken: string): Promise<void> => {
  await apiRequest('/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
};

export const updateOwnProfile = async (
  input: UpdateProfileInput,
  csrfToken: string,
): Promise<AuthenticatedUser['profile']> => {
  const response = await apiRequest('/profiles/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return profileSchema.parse(await response.json());
};
