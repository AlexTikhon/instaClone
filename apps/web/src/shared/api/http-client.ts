import { errorEnvelopeSchema } from '@instaclone/api-contracts';

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const parseError = async (response: Response): Promise<ApiClientError> => {
  const fallback = `Request failed (${response.status})`;
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    return parsed.success
      ? new ApiClientError(parsed.data.error.code, parsed.data.error.message, response.status)
      : new ApiClientError('REQUEST_FAILED', fallback, response.status);
  } catch {
    return new ApiClientError('REQUEST_FAILED', fallback, response.status);
  }
};

export const apiRequest = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, credentials: 'include' });
  if (!response.ok) throw await parseError(response);
  return response;
};
