# ADR 0002: PostgreSQL is the system of record

- Status: Accepted
- Date: 2026-08-10

## Context

Social data has relational constraints, transactional state changes, and idempotency requirements.

## Decision

Persist authoritative business state in PostgreSQL and access it through Prisma. Redis, queue state,
and future search indexes must be reconstructable.

## Consequences

Foreign keys and unique constraints protect correctness, and application changes can atomically write
outbox records. Some specialized read paths may later need projections or caches.
