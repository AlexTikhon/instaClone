import {
  mediaResponseSchema,
  uploadInitializationResponseSchema,
  type InitializeMediaUploadInput,
  type MediaResponse,
  type UploadInitializationResponse,
} from '@instaclone/api-contracts';

import { apiBaseUrl, apiRequest } from '../../shared/api/http-client';

export const initializeMediaUpload = async (
  input: InitializeMediaUploadInput,
  csrfToken: string,
): Promise<UploadInitializationResponse> => {
  const response = await apiRequest('/media/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(input),
  });
  return uploadInitializationResponseSchema.parse(await response.json());
};

export const uploadFileDirectly = (
  upload: UploadInitializationResponse['upload'],
  file: File,
  onProgress: (percentage: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url);
    Object.entries(upload.headers).forEach(([name, value]) =>
      request.setRequestHeader(name, value),
    );
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Object upload failed (${request.status})`));
    });
    request.addEventListener('error', () => reject(new Error('Object upload failed')));
    request.addEventListener('abort', () => reject(new Error('Object upload was cancelled')));
    request.send(file);
  });

export const finalizeMediaUpload = async (
  mediaId: string,
  csrfToken: string,
): Promise<MediaResponse> => {
  const response = await apiRequest(`/media/${mediaId}/finalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: '{}',
  });
  return mediaResponseSchema.parse(await response.json());
};

export const getOwnMedia = async (mediaId: string): Promise<MediaResponse> => {
  const response = await apiRequest(`/media/${mediaId}`);
  return mediaResponseSchema.parse(await response.json());
};

export const waitForReadyMedia = async (
  mediaId: string,
  attempts = 80,
  intervalMs = 750,
): Promise<MediaResponse> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const media = await getOwnMedia(mediaId);
    if (media.status === 'READY') return media;
    if (media.status === 'FAILED')
      throw new Error(
        `Media processing failed${media.failureCode ? ` (${media.failureCode})` : ''}.`,
      );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Media processing is taking longer than expected. Check again later.');
};

export const directUploadOrigin = (): string => new URL(apiBaseUrl).origin;
