import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { WsAdapter } from '@nestjs/platform-ws';

import type { ApiEnvironment } from '@instaclone/config';

import { AppModule } from '../app.module';
import { ApiExceptionFilter } from './errors/api-exception.filter';

export const configureApplication = (app: INestApplication): void => {
  const config = app.get(ConfigService<ApiEnvironment, true>);

  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    credentials: true,
    origin: config.get('API_CORS_ORIGINS', { infer: true }),
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());

  const openApiConfig = new DocumentBuilder()
    .setTitle('InstaClone API')
    .setDescription('InstaClone platform, authentication, and profile API.')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
};

export const createApplication = async (): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApplication(app);
  return app;
};
