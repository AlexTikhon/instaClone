# ADR 0005: Cursor pagination for mutable collections

- Status: Accepted
- Date: 2026-08-10

## Context

Offset pagination becomes expensive and can duplicate or skip results while feeds and conversations
are changing.

## Decision

Use opaque cursor pagination backed by deterministic indexed orderings, normally timestamp plus ID,
for feeds, comments, graph lists, notifications, and messages.

## Consequences

Queries remain stable and scale with page size rather than skipped rows. Arbitrary page-number jumps
are not supported, and cursor compatibility must be versioned deliberately.
