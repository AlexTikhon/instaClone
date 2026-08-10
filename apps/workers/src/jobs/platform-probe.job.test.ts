import { describe, expect, it } from 'vitest';

import { handlePlatformProbe } from './platform-probe.job';

describe('platform probe handler', () => {
  it('accepts an explicit correlation ID', () => {
    const result = handlePlatformProbe({
      correlationId: 'request-123',
      requestedAt: new Date().toISOString(),
    });

    expect(Date.parse(result.handledAt)).not.toBeNaN();
  });

  it('rejects an invalid job envelope', () => {
    expect(() => handlePlatformProbe({ requestedAt: 'yesterday' })).toThrow();
  });
});
