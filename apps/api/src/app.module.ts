import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { parseApiEnvironment, type ApiEnvironment } from '@instaclone/config';

import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ObjectStorageModule } from './infrastructure/object-storage/object-storage.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { createHttpLoggerOptions } from './platform/logging/http-logger.config';
import { ProfilesModule } from './profiles/profiles.module';
import { SocialGraphModule } from './social-graph/social-graph.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: parseApiEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnvironment, true>) =>
        createHttpLoggerOptions(
          config.get('NODE_ENV', { infer: true }),
          config.get('LOG_LEVEL', { infer: true }),
        ),
    }),
    DatabaseModule,
    RedisModule,
    ObjectStorageModule,
    AuthModule,
    ProfilesModule,
    SocialGraphModule,
    HealthModule,
  ],
})
export class AppModule {}
