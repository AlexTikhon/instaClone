# Events and asynchronous work

## Phase 6 Story event and retention work

Story creation commits `Story` and `STORY_CREATED` OutboxEvent atomically. Version 1 contains only
`storyId`, `authorId`, `mediaAssetId`, and `expiresAt`; it carries no signed URL or image content.
The current worker validates the event as a no-op foundation for future analytics/moderation. Story
views remain relational state and do not emit one event per view, avoiding a high-volume event stream
without a Phase 6 consumer. Story creation intentionally creates no user notification.

The worker also runs an hourly idempotent retention statement for records at least 30 days beyond
expiration. Visibility never depends on this schedule. Operational logs use story, author, viewer,
event, and correlation identifiers only. Candidate future metrics are `stories_created_total`,
`story_views_total`, and Story tray latency; Phase 6 adds structured logs but no metrics stack.

## Phase 5 notification projection

The domain queue additionally carries version-1 `USER_FOLLOWED` and `FOLLOW_REQUESTED` events:

- `USER_FOLLOWED { actorId, targetUserId }` is emitted only when a new public follow edge is inserted;
- `FOLLOW_REQUESTED { requesterId, targetUserId }` is emitted only when a new private request is
  inserted.

Both are written inside the Social Graph serializable transaction. Accepting a request does not emit
`USER_FOLLOWED`, because that would notify the accepting target a second time. A distinct acceptance
notification is postponed until product/UI behavior requires it.

`POST_LIKED`, `COMMENT_CREATED`, `USER_FOLLOWED`, and `FOLLOW_REQUESTED` map respectively to `LIKE`,
`COMMENT`, `FOLLOW`, and `FOLLOW_REQUEST` notification types. Domain event names remain facts; the
notification type is a presentation consequence and is not assumed to be permanently one-to-one.
Self-actions are suppressed in the projector.

The notification row is its own durable consumer consequence. Unlike media processing, no separate
`ConsumerEventReceipt` is required: `sourceEventId UNIQUE` makes the consequence and receipt one
database invariant. If the insert fails, the job throws and retries. If the process crashes after
commit and before BullMQ acknowledgement, retry returns the existing row and cannot insert a second
one. A Redis publish failure is logged but does not undo or lose the committed notification.

At-least-once queue delivery and best-effort Pub/Sub may produce duplicate online signals. Clients
deduplicate by notification ID. No global event ordering is promised.

## Phase 4 events and media leases

`POST_LIKED` is written only when a like row is newly inserted. `COMMENT_CREATED` is written with
the new comment. Both events commit atomically with business state and carry useful identifiers,
not content. Phase 5 consumes them in the notification projector. Unlike, unsave, and deletion events
are omitted because no current downstream domain needs them.

Media claims now use a database lease and per-attempt ownership token. Duplicate delivery cannot
claim an active `PROCESSING` row. Transient exceptions release an owned claim; a process crash leaves
it reclaimable after 60 seconds. A crash after thumbnail upload remains safe because the derivative
key is deterministic. Terminal updates require current ownership, preventing a stale worker from
completing over a newer attempt.

## Boundary

BullMQ provides delivery and retry mechanics over Redis. It does not become the source of business
truth. Domain events that must survive failures are persisted in `outbox_events` in the same
PostgreSQL transaction as the aggregate change. A dispatcher publishes committed events later.

The Phase 0 `platform.probe` remains isolated. The `domain-events` queue carries version 1 envelopes
for `MEDIA_UPLOADED`, `POST_CREATED`, `POST_LIKED`, and `COMMENT_CREATED`.

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

Possible future events include `COMMENT_REPLIED`, `USER_FOLLOWED`, `FOLLOW_REQUESTED`,
`USER_MENTIONED`, and `MESSAGE_RECEIVED`. Notification code may consume these events later;
controllers never call notification internals.

## Ordering

Global ordering is neither promised nor required. Workflows that need ordering define a partition key
and sequence strategy—for example, a per-conversation sequence for messages. Consumers reject or
buffer invalid transitions according to their domain policy.
