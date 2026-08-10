import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '@instaclone/config';

import { IDENTITY_REPOSITORY, type IdentityRepository } from '../identity/identity.repository';

@Injectable()
export class AuthCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthCleanupService.name);
  private readonly intervalMs: number;
  private readonly auditRetentionMs: number;
  private interval: NodeJS.Timeout | undefined;

  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    config: ConfigService<ApiEnvironment, true>,
  ) {
    this.intervalMs = config.get('AUTH_CLEANUP_INTERVAL_SECONDS', { infer: true }) * 1_000;
    this.auditRetentionMs = config.get('AUTH_AUDIT_RETENTION_DAYS', { infer: true }) * 86_400_000;
  }

  onModuleInit(): void {
    this.interval = setInterval(
      () =>
        void this.run().catch((error: unknown) => this.logger.error('Auth cleanup failed', error)),
      this.intervalMs,
    );
    this.interval.unref();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  run(now = new Date()): Promise<void> {
    const auditBefore = new Date(now.getTime() - this.auditRetentionMs);
    return this.identities.cleanupExpiredAuthState(now, auditBefore).then(() => undefined);
  }
}
