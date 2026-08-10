import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { ApiEnvironment } from '@instaclone/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.ping();
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
    if (this.client.status === 'wait') await this.client.connect();
    const result = await this.client.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return count`,
      1,
      key,
      windowSeconds,
    );
    const count = Number(result);
    return count <= limit ? windowSeconds : -windowSeconds;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'wait' && this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
