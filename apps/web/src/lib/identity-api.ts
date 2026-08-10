import {
  authResponseSchema,
  csrfResponseSchema,
  profileSchema,
  type AuthenticatedUser,
  type LoginInput,
  type RegisterInput,
  type UpdateProfileInput,
} from '@instaclone/api-contracts';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

const parseError = async (response: Response): Promise<Error> => {
  const fallback = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    return new Error(typeof body.error?.message === 'string' ? body.error.message : fallback);
  } catch {
    return new Error(fallback);
  }
};

const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, credentials: 'include' });
  if (!response.ok) throw await parseError(response);
  return response;
};

export const getCsrfToken = async (): Promise<string> => {
  const response = await request('/auth/csrf');
  return csrfResponseSchema.parse(await response.json()).csrfToken;
};

const mutateAuth = async (
  path: string,
  csrfToken: string,
  body?: LoginInput | RegisterInput,
): Promise<AuthenticatedUser> => {
  const response = await request(path, {
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
  const response = await request('/auth/me');
  return authResponseSchema.parse(await response.json()).user;
};

export const logout = async (csrfToken: string): Promise<void> => {
  await request('/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
};

export const updateOwnProfile = async (
  input: UpdateProfileInput,
  csrfToken: string,
): Promise<AuthenticatedUser['profile']> => {
  const response = await request('/profiles/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return profileSchema.parse(await response.json());
};
