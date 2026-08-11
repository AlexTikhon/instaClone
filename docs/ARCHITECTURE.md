# Architecture

## Phase 5 notifications and realtime foundation

Notifications are a PostgreSQL projection of durable domain events inside the modular monolith. A
like, comment, public follow, or private follow request commits its domain state and outbox intent
together. The domain worker maps that fact to a user-facing `Notification`; controllers never call
notification projection code from the mutation transaction.

The notification insert commits before the worker publishes a small recipient envelope to one Redis
Pub/Sub channel. Every API instance subscribes, routes the envelope to its local set of authenticated
WebSockets for that user, and sends `NOTIFICATION_CREATED`. PostgreSQL is durable delivery; the
WebSocket is a low-latency best-effort signal. A disconnected or sleeping browser recovers with
`GET /notifications` after reconnect.

The worker bootstrap delegates domain event names through a small explicit router. Media processing
retains its lifecycle handler, `POST_CREATED` remains a validated no-op, and notification-producing
events share one projector. This avoids a growing bootstrap switch without introducing a generic
event framework or a service boundary.

Native WebSockets are sufficient for authenticated server-to-client delivery and avoid Socket.IO's
additional protocol, fallback transports, and acknowledgements. The API tracks a set, not a single
socket, per user so tabs and devices all receive online signals. One shared Redis channel is a simple
Phase 5 tradeoff: every API instance sees each small envelope and filters locally. At substantially
larger instance counts, instance-targeted channels could reduce fan-out work without changing
PostgreSQL durability.

## Phase 4 feed and engagement

Feed V1 is a read-composition module. `FeedController` calls `FeedService`, which asks
`CandidateSource` for a relationally filtered page, applies the injected `FeedRanker`, batch-hydrates
engagement, and maps strict response contracts. It consumes Posts' public response mapper and the
shared post-access policy; Posts never depends on Feed.

`CandidateSource` performs fan-out on read in PostgreSQL. Relation filters select the viewer's posts
or accepted-follow authors while excluding disabled/profile-less authors, deleted posts,
either-direction blocks, and inaccessible private authors. It never loads all followed IDs or merges
per-author queries.

`ChronologicalFeedRanker` orders immutable `(createdAt DESC, id DESC)` fields. Mutable engagement is
excluded so cursors remain stable. A future mutable-score ranker will require snapshot semantics.

A feed page uses one candidate-source operation (with Prisma's bounded relation loading for authors
and media) and four parallel engagement queries: grouped like counts, grouped active-comment counts,
viewer-like membership, and viewer-save membership. Depending on Prisma's relation load strategy,
this is approximately five to nine SQL statements regardless of page length, never `1 + N`.
TanStack Query owns browser server state; optimistic like/save mutations snapshot and patch the feed
cache, then apply the server result or roll back.

Fan-out on read gives simple writes and immediate deletion/follow consistency but amplifies reads
for follow-heavy accounts. Measured future options include first-page, engagement-count, and hot-post
caches. Fan-out on write and celebrity hybrids remain out of scope.

## Purpose and current scope

The application is an educational production-engineering system. Phase 0 established operational
and architectural foundations. Phase 1 adds the first product boundary: authentication and profiles;
Phase 1.1 hardens that boundary with recovery, verification, session controls, and audit history.
Phase 2 introduces Social Graph as a separate application and persistence boundary. Phase 3 adds
separate Media and Posts modules and activates the transactional outbox plus the first product worker.
The system remains a modular monolith with a separately scalable worker process.

## Runtime view

```text
Browser -> Next.js web -> NestJS API -> PostgreSQL
                               |      -> Redis
                               +      -> S3-compatible storage (MinIO locally)

Committed outbox event -> lease/claim dispatcher -> BullMQ/Redis -> workers -> PostgreSQL/S3
```

PostgreSQL is the source of truth. Redis holds queue mechanics, caches, rate-limit state, and other
reconstructable ephemeral data only. Binary media belongs in object storage; PostgreSQL will retain
its metadata and state.

## Code boundaries

- `apps/web` owns presentation, navigation, and browser integration.
- `apps/api` owns synchronous application use cases and transactions.
- `apps/workers` owns asynchronous execution and job lifecycle behavior.
- `packages/api-contracts` owns framework-neutral HTTP schemas and types.
- `packages/config` owns validated server process configuration.

Infrastructure adapters live under `apps/api/src/infrastructure`. Product modules added later must
depend on narrow application/domain ports, not concrete Prisma, Redis, or S3 clients. One module may
consume another module's public application API or a published event, but may not query its internal
repository directly.

Auth and Profiles consume a narrow identity repository port implemented by Prisma. Controllers own
HTTP/cookie behavior, services own credential and session use cases, and the repository owns atomic
persistence. Current product modules also include Posts, Media, Engagement, Feed, Social Graph, and
Notifications. Stories, Reels, Search, Messaging, and Moderation remain future phases.

Social Graph owns directed follows, private-account requests, and blocks behind its own repository
port. It reads authenticated actors from Auth but does not reach into Auth persistence. Multi-edge
transitions such as block and request acceptance are serializable PostgreSQL transactions.

Media owns asset identity, actor-derived ownership, generated storage keys, upload authorization,
declared and verified object metadata, signed storage access, and the upload/processing lifecycle.
Posts calls Media's public application service to require ordered, owned, unattached `READY` assets;
it never calls S3 or queries Media persistence directly. Posts owns captions, lifecycle policy,
visibility reads, and the atomic Post/PostMedia/OutboxEvent transaction.

The API's outbox dispatcher is infrastructure, not a product module. It leases committed rows with
`FOR UPDATE SKIP LOCKED`, publishes with `eventId` as the BullMQ job ID, and marks a row published
only after queue acknowledgement. Stale leases are reclaimable. A crash after queue publication but
before the database mark can duplicate delivery, so worker effects remain idempotent.

The web application evolves incrementally: the identity UI remains, while the used create-post
feature lives under `features/create-post`, media/post calls under `entities`, and the shared browser
HTTP boundary under `shared/api`. No empty architecture scaffolding was introduced.

## Request lifecycle

The HTTP logger accepts a bounded, character-restricted `X-Request-ID` or generates a UUID. It
returns that ID in the response, associates it with structured request logs, and places it in the
stable error envelope. Incoming secrets and authentication headers are redacted.

Asynchronous commands/events contain `correlationId`, `eventId`, `occurredAt`, event
name, version, aggregate identity, and payload. Consumers use `eventId` for idempotency and retain
correlation context in logs. The Phase 0 probe remains a boundary check. `MEDIA_UPLOADED` drives
bounded image decoding and thumbnail creation; `POST_CREATED` is the first durable post event.

## Health model

- `GET /api/v1/health/live` answers whether the process can serve HTTP. It never probes downstream
  systems.
- `GET /api/v1/health/ready` probes PostgreSQL, Redis, and the configured object-storage bucket in
  parallel. Any failed dependency produces HTTP 503 and preserves per-dependency status.

This separation keeps an infrastructure outage from causing an orchestrator to endlessly restart a
healthy process while still removing an incapable instance from traffic.

## Evolution rules

Extraction into services is considered only when measurements show an independent scaling,
reliability, deployment, or ownership need. Candidate modules include Feed, Media Processing,
Notifications, and Messaging. Extraction should move a module's application boundary and event
contracts, not require callers to understand its persistence internals.

OpenTelemetry libraries are postponed until spans/metrics have a concrete export destination. The
current request/correlation model and structured logs preserve the context needed to add tracing.

## Dependency policy

Dependencies are exactly pinned and the lockfile is committed. A library is added only when current
code uses it. This is why Phase 0 excludes TanStack Query, React Hook Form, Zustand, Playwright, and
FFmpeg. TypeScript is pinned to 5.9 because the selected lint parser supports TypeScript versions
below 6.1. ESLint is pinned to the latest 9.x release because the React plugin currently bundled by
the Next.js lint preset is not compatible with ESLint 10.

Workspace packages are injected so pnpm can package API and worker deployments into self-contained
production directories. `syncInjectedDepsAfterScripts` refreshes their copies after shared-package
builds, keeping local consumers and container deploy output consistent without shipping development
dependencies.
