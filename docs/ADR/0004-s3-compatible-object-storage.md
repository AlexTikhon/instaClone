# ADR 0004: S3-compatible object storage

- Status: Accepted
- Date: 2026-08-10

## Context

Relational databases and API processes are poor stores and transfer paths for large media binaries.

## Decision

Store media bytes behind an S3-compatible adapter, using MinIO locally. PostgreSQL stores metadata,
ownership, state, and object keys.

## Consequences

The same API works locally and with managed object storage. Provider-specific behavior still requires
integration tests, and bucket policy/CORS configuration becomes explicit infrastructure.
