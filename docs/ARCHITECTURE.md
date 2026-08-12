# Architecture

## Phase 8 direct messaging

Messaging is an application module inside the modular monolith. It owns conversation membership,
message order, send idempotency, read watermarks, and membership authorization. Identity/Profile
remain the source of participant availability, while a narrow Social Graph interaction policy owns
canonical user-pair locking and either-direction block checks. Messaging does not reach Redis or the
WebSocket hub directly.

A V1 conversation stores its two participants as canonical `lowerUserId` and `higherUserId` columns
instead of a general membership table. This deliberately trades future group-chat flexibility for
strong current invariants: a check enforces distinct sorted IDs, a unique pair index prevents two
rows for one pair, and both foreign keys prove exactly two real participants. The Message insert
trigger additionally proves that every sender belongs to the referenced conversation.

Every conversation owns an atomically incremented `BIGINT lastSequence`. Sending holds the same
transaction-scoped advisory pair lock used by block/unblock, increments the sequence, inserts the
message, advances the sender's read watermark, updates activity, and inserts `MESSAGE_CREATED` into
the outbox in one serializable transaction. `UNIQUE(senderId, clientMessageId)` makes exact retries
return the original message. Reuse against another body or conversation is a conflict. This
conversation-local sequence is the stable total order for history, unread counts, and reads; wall
clock time is presentation and conversation-list activity only.

History pages scan `(conversationId, sequence DESC)` and carry an opaque, conversation-bound
sequence cursor. Conversation-list pages use a database `snapshotAt`. For each member conversation,
one indexed lateral lookup derives the latest message at that snapshot, then keysets on
`(activityAt DESC, conversationId DESC)`. Thus a post-snapshot message does not move an unseen row
out of the remaining snapshot. The list is one SQL statement with batched peer, block, preview, and
unread fields; history uses one membership query plus one bounded message query.

Read state is one monotonic sequence watermark per participant on the conversation row. PostgreSQL
`GREATEST` prevents older tabs from moving it backwards, and unread counts use the message index with
`sequence > watermark AND senderId <> viewerId`. A block in either direction disables new creation
and sends but does not erase or hide existing conversation history.

The committed message and outbox event are durable truth. The existing worker validates
`MESSAGE_CREATED` and publishes a body-free hint for recipient and sender sessions to the shared
Redis realtime channel. Every API instance routes it through the existing multi-socket authenticated
native WebSocket hub. The browser invalidates the relevant TanStack Query list, detail, and history;
connect/reconnect invalidates all messaging state. Redis Pub/Sub and WebSockets remain best effort,
and no acknowledgement/replay protocol is required because HTTP reconstructs PostgreSQL state.

The Next.js `/messages` and `/messages/[conversationId]` routes use one responsive list/thread
surface. History is fetched backward, rendered chronologically, and preserves scroll offset when
older pages arrive. Sends retain one browser-generated client message ID through failure/retry;
server responses merge by server/client ID. Read mutation occurs only while the active thread is at
the newest rendered incoming message.

## Phase 7 Search and Explore

Search is a read-oriented application module with a repository port. It interprets and validates
queries, owns relevance and cursor semantics, and composes minimal user or post results; it does not
own Profile, Post, Social Graph, Media, or engagement persistence. The current adapter uses
parameterized PostgreSQL SQL. Controllers and web contracts contain no trigram or SQL concepts, so a
future index can replace the adapter rather than leak through the product.

User search executes one statement for matching, six-tier deterministic ranking, both-direction
block exclusion, account availability, and outgoing relationship state. Literal contains matching is
served by lowercase trigram indexes; exact/prefix matching has lowercase pattern indexes. The cursor
is query-bound and orders by `(rank, normalizedUsername, userId)`.

Explore is distinct from Home: it scans a bounded 30-day window of all legally visible, non-self
posts rather than self/following chronology. It weights snapshot likes and comments and adds a
seven-day hourly freshness component. The first page fixes PostgreSQL `snapshotAt`; retained
like/comment deletion timestamps make score membership reproducible. The cursor keysets
`(score, createdAt, postId)`. Access or lifecycle changes still hide content immediately.

The ranked query returns IDs, score, and ordering fields only. Hydration reapplies
`PostAccessPolicy`, requires READY presentable media, maps through `PostsService` for signed URLs, and
uses `EngagementHydrator` in batch. This yields one candidate query, bounded Prisma relation loading,
and four parallel engagement queries rather than an N+1 loop.

The Next.js layout owns one auth restoration provider. Authenticated routes share a responsive
navigation shell: Home, Search, Explore, Notifications, and Profile. Search uses a 350 ms debounce,
URL state, abort-aware TanStack Query requests, centralized keys, and existing social mutations.
Explore and profile timelines use responsive, aspect-stable lazy image grids.

## Phase 6 Stories

Stories is an explicit product module, not a Post subtype. `Story` owns a single MediaAsset
reference, a 24-hour lifecycle, soft deletion, read models, and durable viewer state. Media remains
the owner of upload validation and signed display URLs; Stories never uses an object-storage client.
READY image assets are immutable references and may be reused by both a Post and one or more Stories.
Deleting or expiring either content record does not synchronously delete the shared binary.

PostgreSQL time is authoritative. Creation uses `CURRENT_TIMESTAMP` and derives
`expiresAt = CURRENT_TIMESTAMP + interval '24 hours'` in the same statement. Tray, sequence, direct
read, and view-recording SQL all require `deletedAt IS NULL AND expiresAt > CURRENT_TIMESTAMP`.
The hourly worker cleanup is storage hygiene, not expiration correctness: it hard-deletes Story and
cascaded StoryView rows only 30 days after expiration, while media cleanup remains future shared work.

The tray is a two-level read model. `GET /stories` executes one relational aggregate over active
self/following Stories, accepted follows, both-direction blocks, author/profile availability, and the
viewer's StoryView rows. PostgreSQL computes `BOOL_OR(view missing)` per non-self author. The result is
limited to 100 author groups and ordered unseen-first, then by latest active Story descending. A
second request loads at most 100 active Stories for the selected author, oldest-first for playback.
This is a constant query count per operation and has no per-followed-author SQL loop.

The web feature uses TanStack Query for tray, per-author sequences, view mutations, deletion, and
viewer pages. A small reducer owns only `isOpen`, `authorIndex`, and `storyIndex`; it advances through
an author's sequence, then the next tray group, and closes after the final group. The current visible
image triggers view recording. A browser-side Set suppresses noisy repeats, while database uniqueness
is the correctness boundary. Six-second image advancement is UX only and cannot extend visibility.

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
persistence. Current product modules also include Posts, Stories, Media, Engagement, Feed, Search,
Social Graph, and Notifications. Reels, Messaging, and Moderation remain future phases.

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
