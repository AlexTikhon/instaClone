import { describe, expect, it } from 'vitest';

import { errorEnvelopeSchema, readinessResponseSchema } from './platform-contracts';

describe('platform contracts', () => {
  it('accepts a valid readiness response', () => {
    const parsed = readinessResponseSchema.parse({
      status: 'ready',
      service: 'api',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: { status: 'up', latencyMs: 1 },
        redis: { status: 'up', latencyMs: 1 },
        objectStorage: { status: 'up', latencyMs: 1 },
      },
    });

    expect(parsed.status).toBe('ready');
  });

  it('rejects an error without a stable code', () => {
    expect(() =>
      errorEnvelopeSchema.parse({
        error: { code: '', message: 'Missing', requestId: 'request-1' },
      }),
    ).toThrow();
  });
});
