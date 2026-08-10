import { livenessResponseSchema, type LivenessResponse } from '@instaclone/api-contracts';

export type ApiStatus = LivenessResponse | { status: 'unavailable' };

export const getApiLiveness = async (): Promise<ApiStatus> => {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

  try {
    const response = await fetch(`${apiBaseUrl}/health/live`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return { status: 'unavailable' };
    return livenessResponseSchema.parse(await response.json());
  } catch {
    return { status: 'unavailable' };
  }
};
