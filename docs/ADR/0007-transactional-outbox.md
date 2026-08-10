# ADR 0007: Transactional outbox for durable events

- Status: Accepted
- Date: 2026-08-10

## Context

Writing PostgreSQL and publishing to a queue are separate operations; a crash between them can lose
an event or expose uncommitted intent.

## Decision

Write durable domain events to `outbox_events` in the same transaction as aggregate state. A separate
dispatcher publishes committed rows to BullMQ and records delivery progress. Consumers remain
idempotent.

## Consequences

Database state and event intent are atomic, at the cost of eventual consistency, dispatcher lag,
cleanup policy, and duplicate delivery. The table and dispatcher are postponed until the first real
event-producing workflow.
