# Events and asynchronous work

## Boundary

BullMQ provides delivery and retry mechanics over Redis. It does not become the source of business
truth. Domain events that must survive failures are persisted in `outbox_events` in the same
PostgreSQL transaction as the aggregate change. A dispatcher publishes committed events later.

The Phase 0 `platform.probe` remains isolated. Phase 3 adds the `domain-events` queue and two version
1 envelopes: `MEDIA_UPLOADED` and `POST_CREATED`.

## Durable envelope

```ts
interface EventEnvelope<TPayload> {
  eventId: string;
  eventName: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
}
```

## Transaction and delivery boundaries

Upload finalization writes `MediaAsset(status=UPLOADED)` and `MEDIA_UPLOADED` in one database
transaction. Post creation writes Post, PostMedia, and `POST_CREATED` in one database transaction.
No BullMQ call occurs inside either transaction.

The dispatcher claims a small ordered batch using PostgreSQL `FOR UPDATE SKIP LOCKED`, writes a
time-bounded lease (`lockedAt`, `lockedBy`), and commits the claim before network publication. After
BullMQ accepts the job, it sets `publishedAt`. Failed publication releases the lease and retains a
bounded diagnostic. A crashed dispatcher can leave a lease that another instance reclaims after 60
seconds.

The database boundary guarantees aggregate state and event intent together. The queue boundary is
at least once: a crash after `Queue.add` and before `publishedAt` can republish. `eventId` is also the
BullMQ job ID for best-effort queue deduplication, but correctness does not depend on it.

## Media consumer

The media worker validates the envelope, claims `UPLOADED -> PROCESSING`, downloads the original,
checks the verified byte count, decodes only JPEG/PNG/WebP with bounded pixels and dimensions, and
writes a deterministic `thumb-640` WebP object. It never overwrites the original.

Successful `READY` or permanent `FAILED` state and the `media-processor-v1` receipt commit in one
database transaction. The unique `(eventId, consumerName)` receipt and terminal lifecycle make
redelivery harmless. Deterministic derived keys make a repeated object write harmless as well.
Storage/database transport failures throw for BullMQ retry; invalid bytes are permanent failures.
Logs carry `correlationId`, `eventId`, and applicable `mediaId`/`postId`, without payload bytes,
signed URLs, tokens, or credentials.

Consumers must be idempotent by `eventId`. Retry policies use bounded exponential backoff and a
finite attempt count. Exhausted jobs remain in BullMQ's failed set with bounded retention for
diagnosis and controlled replay. A separate dead-letter queue is postponed until operations require
one. Handlers distinguish transient dependency failures from permanent validation failures.

Expected future events include `POST_LIKED`, `COMMENT_CREATED`, `COMMENT_REPLIED`, `USER_FOLLOWED`,
`FOLLOW_REQUESTED`, `USER_MENTIONED`, and `MESSAGE_RECEIVED`. Notification code consumes these events;
controllers never call notification internals.

## Ordering

Global ordering is neither promised nor required. Workflows that need ordering define a partition key
and sequence strategy—for example, a per-conversation sequence for messages. Consumers reject or
buffer invalid transitions according to their domain policy.
