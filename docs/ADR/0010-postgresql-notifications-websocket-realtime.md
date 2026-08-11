# ADR 0010: PostgreSQL notifications with best-effort WebSocket realtime

- Status: Accepted
- Date: 2026-08-11

## Context

Social activity must survive browser, API, worker, and connection restarts while still appearing
quickly to an online recipient. Redis Pub/Sub and WebSockets do not retain missed messages, while
synchronously creating notifications in domain requests would couple mutations to a presentation
concern and weaken the existing transactional-outbox boundary.

## Decision

Project versioned outbox events asynchronously into a PostgreSQL `notifications` table. Enforce one
row per domain event with a unique source event ID. After the database commit, publish a small full
notification response over one Redis channel; API instances route it to every authenticated native
WebSocket for the recipient. Browsers deduplicate by notification ID and refetch cursor-paginated
REST state on every connection or reconnection.

## Consequences

PostgreSQL provides durable delivery and read state; Redis and WebSockets only reduce latency.
Duplicate queue delivery and online signals are harmless. Realtime may be missed during an outage,
but REST recovery is sufficient without a replay protocol. Every API instance currently receives
each Redis envelope, which is simple and appropriate at Phase 5 scale but may require instance-aware
routing later. Unread counts remain database queries until caching complexity is justified.
