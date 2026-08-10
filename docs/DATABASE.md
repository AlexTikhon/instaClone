# Database

## Authority

PostgreSQL is the system of record. Redis and search indexes must be reconstructable from committed
PostgreSQL state. Prisma supplies typed access and migrations; application code never uses schema
synchronization in production.

Phase 1's first migration separates users, profiles, credentials, sessions, and refresh-token
history. Credentials and profiles are one-to-one dependents of a user. Sessions and tokens cascade
on user/session deletion; token history is retained for the session lifetime so consumed-token reuse
can be detected. Email and username are normalized by the application and protected by database
unique constraints.

Phase 1.1 adds one-time email-verification and password-reset token tables, device context on
sessions, and authentication audit events. Verification and reset transitions consume tokens with
the associated account update in a transaction. Password changes and resets revoke active sessions
in the same transaction. Expiration and retention indexes support periodic cleanup.

Phase 2 represents the Social Graph with `follows`, `follow_requests`, and `blocks`. Directed pairs
use composite primary keys, indexed reverse lookups, cascading user foreign keys, and explicit
not-self check constraints. Blocking deletes both-direction follow and request edges in the same
serializable transaction that creates the block.

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

Likes and saved posts will use composite uniqueness so retries cannot duplicate state.
Large mutable collections will use keyset/cursor pagination, never primary-flow `OFFSET` pagination.

## Prisma workflow

```bash
pnpm db:generate
pnpm --filter @instaclone/api db:migrate:dev
pnpm --filter @instaclone/api db:migrate:deploy
```

Migration files are reviewed and committed. `migrate dev` is local-only; deployment uses
`migrate deploy`. The API readiness probe executes a constant `SELECT 1`, not an application query.
