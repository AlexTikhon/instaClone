import { z } from 'zod';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const mediaKindSchema = z.enum(['IMAGE', 'VIDEO']);
export const mediaAssetStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'UPLOADED',
  'PROCESSING',
  'READY',
  'FAILED',
]);

export const initializeMediaUploadInputSchema = z.strictObject({
  kind: z.literal('IMAGE'),
  mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_UPLOAD_BYTES),
});

export const finalizeMediaUploadInputSchema = z.strictObject({});

export const mediaResponseSchema = z.object({
  id: z.uuid(),
  kind: mediaKindSchema,
  status: mediaAssetStatusSchema,
  declaredMimeType: z.string(),
  declaredSizeBytes: z.number().int().positive(),
  verifiedSizeBytes: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  url: z.url().nullable(),
});

export const uploadInitializationResponseSchema = z.object({
  media: mediaResponseSchema,
  upload: z.object({
    url: z.url(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});

export type InitializeMediaUploadInput = z.infer<typeof initializeMediaUploadInputSchema>;
export type MediaResponse = z.infer<typeof mediaResponseSchema>;
export type UploadInitializationResponse = z.infer<typeof uploadInitializationResponseSchema>;
export type MediaAssetStatus = z.infer<typeof mediaAssetStatusSchema>;
