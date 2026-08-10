import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../infrastructure/database/prisma.service';
import type { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import type { RedisService } from '../infrastructure/redis/redis.service';
import { HealthService } from './health.service';

const dependency = (fails = false): { ping: () => Promise<void> } => ({
  ping: fails
    ? vi.fn().mockRejectedValue(new Error('unavailable'))
    : vi.fn().mockResolvedValue(undefined),
});

describe('HealthService', () => {
  it('reports ready only when every dependency is reachable', async () => {
    const service = new HealthService(
      dependency() as PrismaService,
      dependency() as RedisService,
      dependency() as ObjectStorageService,
    );

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ready',
      dependencies: {
        database: { status: 'up' },
        redis: { status: 'up' },
        objectStorage: { status: 'up' },
      },
    });
  });

  it('reports not ready without hiding which dependency failed', async () => {
    const service = new HealthService(
      dependency() as PrismaService,
      dependency(true) as RedisService,
      dependency() as ObjectStorageService,
    );

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'not_ready',
      dependencies: { redis: { status: 'down' } },
    });
  });
});
