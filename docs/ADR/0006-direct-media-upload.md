# ADR 0006: Direct browser-to-object-storage uploads

- Status: Accepted
- Date: 2026-08-10

## Context

Proxying large media through NestJS wastes API bandwidth, memory, and connection capacity.

## Decision

The authenticated API will authorize an upload and return a short-lived presigned object-storage URL.
The browser uploads directly, then calls a finalization use case that verifies the object and commits
the post workflow.

## Consequences

API scaling is decoupled from media size. Upload policy, storage CORS, expiry, cleanup of abandoned
objects, and server-side verification must be designed explicitly in Phase 3.
