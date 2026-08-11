# ADR 0012: PostgreSQL-backed Search and Explore V1

- Status: Accepted
- Date: 2026-08-11

## Context

Phase 7 needs privacy-safe user discovery and a ranked post surface. PostgreSQL already owns
profiles, social relationships, content lifecycle, and engagement. Introducing a second index now
would add outbox consumers, replay tooling, consistency lag, and operational failure modes before
the product needs typo tolerance, linguistic analysis, or cross-entity relevance.

Ranked collections also need pagination semantics that match their ordering. An engagement score
computed from live rows cannot safely use an ordinary cursor: likes or comments changing between
requests could move a post across the boundary. Offset pagination has the same duplicate/skip
problem and grows with the requested window.

## Decision

Search is an explicit application boundary under `apps/api/src/search`. Controllers depend on its
service and repository port, not Prisma or PostgreSQL-specific ranking details. The Prisma adapter
may be replaced later without changing HTTP contracts.

User queries are trimmed, internal whitespace is collapsed, and case is normalized. Two to sixty
characters are accepted. `%`, `_`, and the escape character are escaped before `LIKE`, and every
value remains a query parameter. Results use these ascending relevance tiers:

1. exact username;
2. username prefix;
3. exact display name;
4. display-name prefix;
5. username contains;
6. display-name contains.

Ties use normalized username and user ID ascending. The opaque cursor contains that tuple and the
normalized query, so it cannot be reused with another query. A page is one SQL statement, including
relationship state and both-direction block filtering.

PostgreSQL's `pg_trgm` extension backs lowercase contains searches with GIN indexes. Lowercase
`text_pattern_ops` indexes cover exact/prefix access. The migration explicitly creates the extension;
production database roles therefore need permission to install it during migration, or operations
must preinstall it. No background indexer exists.

Explore considers visible, non-self posts created in the 30 days before the first-page database
timestamp. It excludes deleted posts, unavailable authors, both block directions, inaccessible
private accounts, and any post with missing or non-READY presentation media. The integer score is:

```text
min(snapshot likes, 10,000) * 3
+ min(snapshot active comments, 10,000) * 5
+ max(0, 168 - whole age hours)
```

Ordering is `(score DESC, createdAt DESC, postId DESC)`. The first page captures `snapshotAt`; its
opaque cursor carries the snapshot and ordering tuple. Likes now retain `deletedAt`, as comments
already do, so membership at `snapshotAt` remains reconstructable across pages after unlike/delete
or new engagement. Privacy, block, account, post, and media changes intentionally take effect
immediately and can remove an item from a later page; they can never make inaccessible content leak.

Candidate generation is one ranked SQL statement. Post/media/profile hydration then reapplies the
shared `PostAccessPolicy`; existing post response mapping signs media URLs, and the existing batch
engagement hydrator performs four constant-count queries. Query count is bounded by page composition,
not page length.

Authenticated Search and Explore are limited to 120 requests per IP-derived bucket per minute, have
bounded page/query sizes, and do not log query text. This is a basic abuse boundary, not a complete
enumeration-defense system.

## Consequences

The system stays immediately consistent and operationally small. Search relevance is deliberately
literal: there is no typo tolerance, stemming, transliteration, synonym model, hashtag domain, or
ranking experimentation platform. Trigram indexes consume write and storage capacity, and Explore's
correlated engagement counts amplify reads over the bounded 30-day candidate window.

Move to a dedicated index only after measurements or product requirements show one or more of:

- unacceptable PostgreSQL latency at the actual profile/post count;
- required typo tolerance, language-aware stemming, or multilingual analyzers;
- large-scale hashtag/content discovery or cross-entity indexing;
- advanced relevance features or frequent ranking experiments;
- search write/read throughput that competes with transactional workloads.

The future path is PostgreSQL domain state, durable outbox events, an idempotent indexing consumer,
and a dedicated search backend. Search's repository port preserves that extraction seam. OpenSearch,
Elasticsearch, and other search services are postponed until one of those triggers is observed.
