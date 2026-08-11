# ADR 0009: Feed V1 uses fan-out on read

## Status

Accepted for Phase 4.

## Decision

Generate Home candidates in PostgreSQL at request time from the viewer's own posts and accepted
follows. Enforce visibility relationally, order by `(createdAt DESC, id DESC)`, keyset-page that
order, and batch-hydrate engagement. Keep candidate generation behind `CandidateSource` and ordering
behind `FeedRanker`; V1 injects `ChronologicalFeedRanker`.

## Consequences

Writes stay simple and delete, follow, unfollow, block, and privacy changes are immediately
consistent. There is no Redis timeline to repair. The cost is read amplification for follow-heavy
viewers and limited ranking complexity. Mutable engagement cannot enter the V1 cursor without
snapshot semantics because score changes would cause missing or duplicate items.

First-page, engagement-count, and hot-post caches are possible after measurement. Fan-out on write
or a hybrid celebrity path may later replace `CandidateSource` without changing the controller.
