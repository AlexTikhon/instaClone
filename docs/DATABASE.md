# Database

## Notifications

`notifications` is the durable user-facing consequence of social domain events. It stores the
recipient, notification type, nullable actor/post/comment references, creation/read timestamps, and
the source event ID. `sourceEventId` is unique, so concurrent at-least-once deliveries use a single
`INSERT ... ON CONFLICT` invariant rather than a racy read-before-write check.

The actor username and display name are the only immutable presentation snapshot. They keep old
activity renderable when an actor is disabled or deleted without copying a profile or post JSON
document. Recipient deletion cascades the row; actor, post, and comment hard deletion sets the
reference null. Soft-deleted posts/comments remain referenced but the API reports their content as
unavailable. Notifications are retained indefinitely in the local/demo phase; a later retention job
may archive or delete old rows after a product retention period is chosen.

Concrete indexes are deliberately limited:

- unique `sourceEventId` enforces projection idempotency;
- `(recipientId, createdAt, id)` supports recipient-owned descending keyset pages;
- partial `recipientId WHERE readAt IS NULL` supports the exact unread-count predicate without
  indexing read history.

Unread count is computed from PostgreSQL for correctness. Redis counters are intentionally deferred
until query volume demonstrates a need and a reconciliation strategy exists.

## Phase 4 schema and access paths

`post_likes` and `saved_posts` use `(userId, postId)` primary keys. Conflict-safe inserts make
concurrent PUTs idempotent. Their `postId` indexes serve aggregation because the primary-key prefix
is `userId`.

`comments` is top-level-only. Soft-deleted rows are retained and a check rejects blank bodies.
`(postId, deletedAt, createdAt, id)` matches active-comment pages/counts; `(authorId, createdAt)`
supports ownership and retention. Normal post deletion sets `deletedAt` and retains media and
engagement for future asynchronous cleanup.

`posts(deletedAt, createdAt, id)` supports the active chronological feed scan. Existing follow and
block keys support relationship checks. Representative plans can use the deterministic
`pnpm --filter @instaclone/api db:seed:scale` utility, never normal tests or migrations.

On the deterministic 100-user/1,000-post dataset, PostgreSQL 17 used the active-post index, the
`follows` composite primary key for membership probes, and block indexes, with a top-N heapsort of
28 KiB. A local `EXPLAIN (ANALYZE, BUFFERS)` returned 21 rows in approximately 1.4 ms. This is a
development baseline, not a production SLO; larger and differently distributed data must be measured.

Media processing records `processingStartedAt`, `processingLeaseUntil`, and per-attempt
`processingWorkerId`. `(status, processingLeaseUntil)` finds abandoned claims. Terminal transitions
require ownership and commit the consumer receipt atomically.

Interaction transactions take a shared lock on the target post before rechecking visibility; post
deletion takes an exclusive lock. Concurrent interactions can proceed together, while deletion is
serialized against the authorization-to-write window so no request authorizes against stale state.

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

Likes and saved posts use composite uniqueness so retries cannot duplicate state.
Large mutable collections will use keyset/cursor pagination, never primary-flow `OFFSET` pagination.

## Prisma workflow

```bash
pnpm db:generate
pnpm --filter @instaclone/api db:migrate:dev
pnpm --filter @instaclone/api db:migrate:deploy
```

Migration files are reviewed and committed. `migrate dev` is local-only; deployment uses
`migrate deploy`. The API readiness probe executes a constant `SELECT 1`, not an application query.
