# ADR 0014: Moderation and trust/safety V1 in the modular monolith

- Status: Accepted
- Date: 2026-08-12

## Context

Profiles, posts, comments, Stories, and one-to-one messages create enough user-generated surface to
need reporting and human enforcement. The system already has PostgreSQL transactions, shared access
policies, database-backed sessions, and a transactional outbox. No observed report volume,
organizational ownership, or classifier workload justifies a new service or event platform.

A report is an allegation, not a decision. Multiple people can report the same target, concurrent
first reports must not create competing work, an author may delete content after it is reported, and
enforcement must disappear consistently across every read path. Account suspension must also take
effect for existing sessions rather than only future logins.

## Decision

Keep Moderation as an explicit module in the modular monolith. It owns Report, ModerationCase,
ModerationDecision, the transition policy, and ModerationAuditLog. Content and identity domains
remain the owners of their rows; Moderation coordinates narrow, target-specific enforcement inside
the same PostgreSQL transaction required for a correct decision.

### Reports, cases, and concurrency

Support user/profile, post, comment, and Story reports. Individual-message reporting is deferred to
Phase 9.1 because private-conversation evidence access and message enforcement have distinct policy
semantics. Each report stores `targetType`/`targetId` plus exactly one matching nullable foreign key.
Insert triggers and checks validate that representation. `ON DELETE SET NULL` permits later content
retention while preserving the immutable identity and evidence snapshot.

Reports snapshot only bounded source text, username, owner ID, and media asset IDs. They do not copy
media bytes. This preserves enough evidence after author deletion for V1 review, at the cost of
retaining a small amount of user content until a future explicit moderation-retention policy removes
the case. Snapshot text and report details are privileged data.

One active case groups all reports for a target. Report creation acquires a transaction-scoped
advisory lock derived from target type/ID before checking or inserting the case. A partial unique
index on target type/ID for `OPEN` and `IN_REVIEW` is the independent database invariant. A closed
case followed by a later report creates a new historical epoch. A second partial unique index
allows only one active report for a reporter/target/reason, while other reasons and other reporters
remain valid signals.

### State, authorization, and actions

The case state machine is `OPEN -> IN_REVIEW -> CLOSED`, with direct `OPEN -> CLOSED` allowed.
Reopening and appeals are outside V1. Resolution locks the case row and a unique decision per case
prevents concurrent or retry-driven conflicting outcomes. Invalid repeated transitions return a
deterministic conflict.

Use three roles: `USER`, `MODERATOR`, and `ADMIN`. Users file reports. Moderators list and inspect
cases, start review, select no action, and remove post/comment/Story content. Admins have the same
capabilities and may suspend accounts. This distinction is meaningful because suspension revokes all
sessions and hides all normal account content. Roles are assigned by an explicit database-backed CLI
command, never a public endpoint; no general RBAC framework is introduced.

V1 decisions are `NO_ACTION`, `REMOVE_CONTENT`, and `SUSPEND_ACCOUNT`. Moderator removal sets
`moderationRemovedAt`, deliberately separate from author `deletedAt` for audit and future appeal
semantics. Removed comments are omitted rather than tombstoned because replies are not modeled.
Removed media objects are not synchronously deleted: media may be shared, retained as evidence, and
already participates in a delayed lifecycle.

Suspension uses the existing `User.disabledAt` availability state and atomically revokes active
sessions with `ACCOUNT_DISABLED`. The existing authenticator and WebSocket revalidation check the
database, so stale tokens stop working. Profiles and authored content disappear from public profile,
Feed, Search, Explore, and Story delivery. Content remains in PostgreSQL. Existing DM history remains
available to the other participant, but a suspended account cannot authenticate, create a
conversation, or send; other users cannot start a new conversation with it.

### Audit, transactions, and downstream effects

Every successful privileged transition appends exactly one ModerationAuditLog row with actor, case,
action, target, and timestamp. Free-text report details and private notes are not duplicated into
audit metadata. A database trigger rejects ordinary update/delete. Explicit retention maintenance
may opt into a transaction-local bypass unavailable to application routes.

Resolution is one transaction: lock case, validate transition and role/action, apply content or
account enforcement, insert the unique decision, append audit, insert a minimal outbox event when
there is enforcement, close reports, and close the case. Failure rolls everything back. Events are
`CONTENT_MODERATED` and `ACCOUNT_SUSPENDED`; neither includes reporters, content bodies, notes, or
moderator IDs. Reporter notifications are omitted because useful detail could disclose private
enforcement information. Realtime invalidation is best effort and deferred; HTTP reads enforce state
immediately.

### Cross-module enforcement

Extend the existing shared post and Story access predicates with `moderationRemovedAt IS NULL`.
Feed, profile timelines, direct post reads, engagement, Search/Explore hydration, Story tray,
sequences, direct Story reads, and new views already use these seams. Comment reads and counts apply
the matching lifecycle predicate. Account availability remains `disabledAt IS NULL`; public profile
lookup is aligned with Search, Messaging, and content policies and also excludes either-direction
blocks.

## Consequences and limits

PostgreSQL remains the consistency boundary and moderation queries stay operationally simple. Case
lists use deterministic keyset pagination and bounded relation counts; detail loads at most 50
reports. Partial indexes and advisory locks make the critical grouping invariant visible and
testable. The module necessarily coordinates several target-specific updates, but it does not own a
generic cross-domain repository or expose Prisma types in contracts.

There are no appeals, warnings/strikes, temporary restrictions, reporter status pages, reporter
notifications, message reports, message deletion, automated classification, reputation scores, or
legal-support portals. Evidence retention has no timed deletion policy yet. The rate limiter uses the
existing IP-derived fixed-window infrastructure rather than a trust score. A media download URL
issued before removal can remain usable until its short signature lifetime expires; new application
reads stop issuing URLs as soon as enforcement commits.

Machine-learning and external moderation APIs are deferred because V1 needs trustworthy human
workflow, authorization, invariants, and enforcement before probabilistic automation. Automated
decisions would introduce model evaluation, thresholds, appeal policy, false-positive controls,
evidence provenance, and new operational ownership.

## Extraction triggers

A separate Trust & Safety system becomes justified only with evidence such as very high report
volume, an independently operating moderation team, legal retention requirements, asynchronous
classifiers, a materially complex policy engine, independent data-access boundaries, high-volume
evidence storage, external moderation vendors, or regulatory audit requirements. Extraction should
move the established case/application boundary and consume durable enforcement facts. It must not
force content modules to understand moderation persistence. Kafka or another stream is not added
until throughput or replay requirements demonstrate a need.
