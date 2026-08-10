import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generation does not need a live database. Runtime validation still requires
    // DATABASE_URL before the API can start.
    url:
      process.env.DATABASE_URL ??
      'postgresql://generate:generate@localhost:5432/generate?schema=public',
  },
});
