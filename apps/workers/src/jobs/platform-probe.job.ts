import { z } from 'zod';

export const PLATFORM_QUEUE = 'platform';
export const PLATFORM_PROBE_JOB = 'platform.probe';

export const platformProbeDataSchema = z.object({
  correlationId: z.string().min(1).max(128),
  requestedAt: z.iso.datetime(),
});

export type PlatformProbeData = z.infer<typeof platformProbeDataSchema>;

export interface PlatformProbeResult {
  handledAt: string;
}

export const handlePlatformProbe = (input: unknown): PlatformProbeResult => {
  platformProbeDataSchema.parse(input);
  return { handledAt: new Date().toISOString() };
};
