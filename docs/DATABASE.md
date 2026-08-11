# Database

## Authority

PostgreSQL is the system of record. Redis and search indexes must be reconstructable from committed
PostgreSQL state. Prisma supplies typed access and migrations; application code never uses schema
synchronization in production.

The API uses the generated Prisma client. The worker has a deliberately narrow, parameterized `pg`
adapter for MediaAsset terminal transitions and consumer receipts because the generated client is
currently API-local. If worker persistence grows beyond this bounded flow, extracting a shared
database package is preferable to duplicating schemas or importing API internals.

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

Phase 2 hardening changes incoming-request access to the deterministic descending key
`(targetId, createdAt, requesterId)`. The matching composite index supports bounded keyset pages.

Phase 3 adds `media_assets`, `posts`, `post_media`, `outbox_events`, and
`consumer_event_receipts`:

- `media_assets` stores ownership, generated object keys, declared metadata, independently verified
  size, decoded metadata, and explicit lifecycle state. Binary bytes remain in object storage.
- `posts` stores authored captions and soft-deletion state. `(authorId, createdAt, id)` supports the
  actual author-timeline cursor query.
- `post_media` has unique `(postId, position)` ordering and a unique `mediaAssetId`; one asset cannot
  be attached to multiple posts through retries or races.
- `outbox_events` contains the durable envelope plus lease/publication fields. The
  `(publishedAt, lockedAt, occurredAt)` index serves the unpublished dispatcher scan.
- `consumer_event_receipts` uses `(eventId, consumerName)` as its primary key. The media worker
  records the receipt in the same PostgreSQL transaction as a terminal `READY` or `FAILED` update.

`media_assets(ownerId, createdAt)` supports owned-media lifecycle/cleanup reads and
`media_assets(status, updatedAt)` supports stuck/abandoned lifecycle maintenance. These are the only
new media indexes beyond unique keys and the primary key.

Post creation first validates Media through its application boundary, then one PostgreSQL
transaction inserts the Post, ordered PostMedia rows, and `POST_CREATED` OutboxEvent. A unique-media
race aborts the whole transaction, including its event. Upload finalization similarly commits the
`UPLOADED` transition and `MEDIA_UPLOADED` intent atomically.

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
