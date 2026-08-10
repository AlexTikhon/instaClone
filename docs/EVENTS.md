# Events and asynchronous work

## Boundary

BullMQ provides delivery and retry mechanics over Redis. It does not become the source of business
truth. Domain events that must survive failures will first be persisted in `outbox_events` in the same
PostgreSQL transaction as the aggregate change. A dispatcher will publish committed events later.

Phase 0 starts the worker process and registers only `platform.probe`. No API workflow publishes it;
the job exists to validate the worker boundary and correlation envelope without inventing product
behavior.

## Future envelope

```ts
interface EventEnvelope<TPayload> {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
}
```

Consumers must be idempotent by `eventId`. Retry policies use a bounded exponential backoff with
jitter and a finite attempt count. Exhausted jobs move to a dead-letter path with enough metadata for
diagnosis and controlled replay. Handlers must distinguish transient dependency failures from
permanent validation failures.

Expected future events include `POST_LIKED`, `COMMENT_CREATED`, `COMMENT_REPLIED`, `USER_FOLLOWED`,
`FOLLOW_REQUESTED`, `USER_MENTIONED`, and `MESSAGE_RECEIVED`. Notification code consumes these events;
controllers never call notification internals.

## Ordering

Global ordering is neither promised nor required. Workflows that need ordering define a partition key
and sequence strategy—for example, a per-conversation sequence for messages. Consumers reject or
buffer invalid transitions according to their domain policy.
