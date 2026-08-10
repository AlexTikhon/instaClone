# ADR 0003: Redis and BullMQ for asynchronous jobs

- Status: Accepted
- Date: 2026-08-10

## Context

Media processing and downstream reactions should not extend synchronous request latency.

## Decision

Use BullMQ over Redis for job delivery, retries, scheduling, and worker concurrency. Durable business
events enter queues through the transactional outbox, not directly from controllers.

## Consequences

The stack is approachable and operationally suitable for the initial scale. Consumers still require
idempotency and dead-letter handling because delivery is at least once. Redis loss cannot lose the
only copy of business truth.
