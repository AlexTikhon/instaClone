import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '@instaclone/config';

import { createApplication } from './platform/bootstrap';

const bootstrap = async (): Promise<void> => {
  const app = await createApplication();
  const config = app.get(ConfigService<ApiEnvironment, true>);
  await app.listen(config.get('API_PORT', { infer: true }), '0.0.0.0');
};

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`API bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});
