# Database

## Authority

PostgreSQL is the system of record. Redis and search indexes must be reconstructable from committed
PostgreSQL state. Prisma supplies typed access and migrations; application code never uses schema
synchronization in production.

Phase 0 has a deliberately empty Prisma schema. Creating speculative product tables before identity,
privacy, and lifecycle policies are implemented would freeze unreviewed assumptions. Phase 1 will
create the first migration for users, profiles, credentials, and sessions.

## Modelling conventions

Future tables should use:

- application-generated UUID-compatible identifiers where offline creation or cross-service movement
  matters;
- `createdAt` and `updatedAt` timestamps stored as timezone-aware instants;
- explicit nullable `deletedAt` only where recoverability, audit, or reference retention requires soft
  deletion;
- foreign keys for relational integrity and unique constraints for idempotent operations;
- indexes derived from concrete query shapes, including `(createdAt, id)` or equivalent stable cursor
  orderings;
- transactions around aggregate state changes and their outbox records.

Likes, follows, and saved posts will use composite uniqueness so retries cannot duplicate state.
Large mutable collections will use keyset/cursor pagination, never primary-flow `OFFSET` pagination.

## Prisma workflow

```bash
pnpm db:generate
pnpm --filter @instaclone/api db:migrate:dev
pnpm --filter @instaclone/api db:migrate:deploy
```

Migration files are reviewed and committed. `migrate dev` is local-only; deployment uses
`migrate deploy`. The API readiness probe executes a constant `SELECT 1`, not an application query.
