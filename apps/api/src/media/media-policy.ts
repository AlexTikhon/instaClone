import {
  MAX_IMAGE_UPLOAD_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type InitializeMediaUploadInput,
} from '@instaclone/api-contracts';

export const IMAGE_UPLOAD_URL_TTL_SECONDS = 300;

export const validateImageUpload = (input: InitializeMediaUploadInput): void => {
  if (input.kind !== 'IMAGE') throw new Error('Only image uploads are supported');
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(input.mimeType)) {
    throw new Error('Unsupported image MIME type');
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('Image size is outside the allowed range');
  }
};

export const validateStoredObject = (
  declared: { mimeType: string; sizeBytes: number },
  stored: { contentType: string | null; contentLength: number | null },
): number => {
  if (
    stored.contentLength === null ||
    stored.contentLength <= 0 ||
    stored.contentLength > MAX_IMAGE_UPLOAD_BYTES ||
    stored.contentLength !== declared.sizeBytes ||
    stored.contentType !== declared.mimeType
  ) {
    throw new Error('Stored object metadata does not match the authorized upload');
  }
  return stored.contentLength;
};
