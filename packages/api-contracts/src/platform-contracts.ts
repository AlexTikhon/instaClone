import { z } from 'zod';

export const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
});

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
  dependencies: z.object({
    database: dependencyHealthSchema,
    redis: dependencyHealthSchema,
    objectStorage: dependencyHealthSchema,
  }),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
