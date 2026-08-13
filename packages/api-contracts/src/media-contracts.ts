import { z } from 'zod';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_VIDEO_UPLOAD_BYTES = 150 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 90;
export const SUPPORTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

export const mediaKindSchema = z.enum(['IMAGE', 'VIDEO']);
export const mediaAssetStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'UPLOADED',
  'PROCESSING',
  'READY',
  'FAILED',
]);

export const initializeMediaUploadInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('IMAGE'),
    mimeType: z.enum(SUPPORTED_IMAGE_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_IMAGE_UPLOAD_BYTES),
  }),
  z.strictObject({
    kind: z.literal('VIDEO'),
    mimeType: z.enum(SUPPORTED_VIDEO_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_VIDEO_UPLOAD_BYTES),
  }),
]);

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
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  frameRate: z.number().positive().nullable(),
  rotationDegrees: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .nullable(),
  failureCode: z.string().nullable(),
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
