# ADR 0011: Independent Stories with database-time expiration

## Status

Accepted for Phase 6.

## Decision

Model Story independently from Post. Both may reference an immutable READY MediaAsset, and neither
owns synchronous binary deletion. Story creation and every active-content predicate use PostgreSQL
time; public visibility ends at `expiresAt` even when cleanup has not run. Durable first-view state is
stored in a composite-key StoryView row.

## Consequences

Post and Story lifecycle can evolve without subtype coupling, and cross-domain media reuse avoids
copying objects. Media retention must account for references from both domains before deleting an
asset. Raw parameterized PostgreSQL is used for time-sensitive Story reads because Prisma query
filters cannot express `CURRENT_TIMESTAMP` as the comparison value. A separate 30-day cleanup job
controls retention without participating in visibility correctness.
