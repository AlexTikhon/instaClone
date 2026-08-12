# ADR 0013: Direct messaging V1 in the modular monolith

- Status: Accepted
- Date: 2026-08-12

## Context

InstaClone needs correct one-to-one text messaging, including concurrent conversation creation,
retry-safe sends, total order, unread state, blocks, and low-latency online delivery. PostgreSQL,
transactional outbox, BullMQ, Redis Pub/Sub, and authenticated native WebSockets already provide the
needed correctness and transport primitives. A separate service or event platform would add failure
boundaries without solving a present scaling constraint.

## Decision

Keep Messaging as an explicit module in the TypeScript modular monolith. Represent a V1
conversation with canonical sorted lower/higher user foreign keys and a unique pair constraint. This
guarantees exactly two distinct participants and converges concurrent A→B/B→A creation. It is an
intentional V1 schema, not a premature group-membership abstraction.

Allocate an atomic per-conversation `BIGINT` sequence in the send transaction. Sequence, rather than
timestamp/UUID coincidence, defines ordering, backward cursor pagination, read watermarks, and unread
range counts. Serialize create/send/block/unblock for one canonical pair with the same PostgreSQL
transaction advisory lock; whichever operation obtains and commits the lock first defines the race.

Make `(senderId, clientMessageId)` unique. An exact retry for the same conversation and body returns
the persisted message; reuse for other content or a conversation is a conflict. Preserve the caller's
text bytes apart from protocol decoding, while requiring a non-whitespace character and a 4,000
character maximum.

Store one read sequence per participant. Sending advances the sender's watermark. Explicit reads use
`GREATEST`, validate that the target message is accessible in that conversation, and calculate unread
with an indexed sequence range excluding self-sent messages.

Page message history newest-first with an opaque conversation-bound sequence cursor. Page the
mutable conversation list using a database snapshot and derive each conversation's latest message at
that snapshot before keysetting on activity plus ID. A fresh list request sees later activity; an
in-progress snapshot does not skip a row merely because a new message arrived.

Commit `MESSAGE_CREATED` with the message and publish only a body-free hint through the existing
outbox → BullMQ worker → shared Redis channel → API hub → authenticated WebSocket path. Send the hint
to both participants' sockets. PostgreSQL is durable truth and HTTP refetch is reconnect recovery;
WebSocket acknowledgement or replay is out of scope.

If either user blocks the other, no new conversation or message is accepted. Existing participants
retain their conversation and history, and clients disable the composer. An exact idempotent retry
may still return a message that was durably created before the block.

## Consequences

Pair locking deliberately serializes sends within one conversation, simplifying Phase 8 block/order
semantics while unrelated conversations remain concurrent. The two-column membership and two read
watermarks do not support groups; adding groups requires a planned schema evolution, not nullable
participant slots. Conversation-list snapshot SQL is more involved but has deterministic semantics.
Realtime delivery may be delayed or missed without data loss.

## Extraction triggers

Messaging remains in-process until evidence shows an operationally distinct system: messaging
dominates API traffic, message storage needs dedicated partitioning/sharding or retention, delivery
fan-out or multi-region realtime becomes substantial, independent deploy/reliability goals emerge,
group-chat fan-out changes the model, or a dedicated team owns it. A future boundary could be a
Messaging API/Gateway over a message store and durable stream, but none is implemented now.

## Deferred work

Group chats, attachments, delivery/read receipts visible to peers, presence, typing, edit/delete,
search, push notifications, end-to-end encryption, and message retention are outside V1. The browser
uses a retryable pending state rather than persistent offline send storage. Conversation list pages
are snapshot-consistent per cursor chain; a user refreshes to see activity after that snapshot.
