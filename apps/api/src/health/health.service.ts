import { Injectable } from '@nestjs/common';

import type {
  DependencyHealth,
  LivenessResponse,
  ReadinessResponse,
} from '@instaclone/api-contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { RedisService } from '../infrastructure/redis/redis.service';

const probe = async (check: () => Promise<void>): Promise<DependencyHealth> => {
  const startedAt = performance.now();
  try {
    await check();
    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { status: 'down', latencyMs: Math.round(performance.now() - startedAt) };
  }
};

@Injectable()
export class HealthService {
  constructor(
    private readonly database: PrismaService,
    private readonly redis: RedisService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  liveness(): LivenessResponse {
    return { status: 'ok', service: 'api', timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis, objectStorage] = await Promise.all([
      probe(() => this.database.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.objectStorage.ping()),
    ]);
    const dependencies = { database, redis, objectStorage };
    const ready = Object.values(dependencies).every((dependency) => dependency.status === 'up');

    return {
      status: ready ? 'ready' : 'not_ready',
      service: 'api',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
