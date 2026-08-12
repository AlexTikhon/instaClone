import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const email = process.argv[2]?.trim().toLowerCase();
const role = process.argv[3]?.trim().toUpperCase();
if (!email || !['USER', 'MODERATOR', 'ADMIN'].includes(role ?? '')) {
  throw new Error(
    'Usage: pnpm --filter @instaclone/api db:assign-role <email> <USER|MODERATOR|ADMIN>',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

void prisma.user
  .update({
    where: { email },
    data: { role: role as 'USER' | 'MODERATOR' | 'ADMIN' },
    select: { id: true, email: true, role: true },
  })
  .then((user) => process.stdout.write(`Assigned ${user.role} to ${user.email} (${user.id}).\n`))
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Role assignment failed'}\n`);
    process.exitCode = 1;
  });
