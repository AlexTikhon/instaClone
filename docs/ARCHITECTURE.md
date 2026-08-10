# Architecture

## Purpose and current scope

The application is an educational production-engineering system. Phase 0 establishes operational
and architectural foundations without implementing product behavior. The system begins as a
modular monolith with a separately scalable worker process.

## Runtime view

```text
Browser -> Next.js web -> NestJS API -> PostgreSQL
                               |      -> Redis
                               +      -> S3-compatible storage (MinIO locally)

Future committed outbox event -> dispatcher -> BullMQ/Redis -> workers
```

PostgreSQL is the source of truth. Redis holds queue mechanics, caches, rate-limit state, and other
reconstructable ephemeral data only. Binary media belongs in object storage; PostgreSQL will retain
its metadata and state.

## Code boundaries

- `apps/web` owns presentation, navigation, and browser integration.
- `apps/api` owns synchronous application use cases and transactions.
- `apps/workers` owns asynchronous execution and job lifecycle behavior.
- `packages/api-contracts` owns framework-neutral HTTP schemas and types.
- `packages/config` owns validated server process configuration.

Infrastructure adapters live under `apps/api/src/infrastructure`. Product modules added later must
depend on narrow application/domain ports, not concrete Prisma, Redis, or S3 clients. One module may
consume another module's public application API or a published event, but may not query its internal
repository directly.

The intended product modules are Auth, Users, Profiles, Social Graph, Posts, Media, Reactions,
Comments, Saved Posts, Feed, Stories, Reels, Search, Messaging, Notifications, and Moderation. None
exists in Phase 0 because an empty module creates ceremony without behavior or policy to protect.

## Request lifecycle

The HTTP logger accepts a bounded, character-restricted `X-Request-ID` or generates a UUID. It
returns that ID in the response, associates it with structured request logs, and places it in the
stable error envelope. Incoming secrets and authentication headers are redacted.

Future asynchronous commands/events must contain `correlationId`, `eventId`, `occurredAt`, event
name, version, and payload. Consumers must use `eventId` for idempotency and retain correlation
context in logs. The Phase 0 probe job demonstrates envelope validation only; it is not a product
event.

## Health model

- `GET /api/v1/health/live` answers whether the process can serve HTTP. It never probes downstream
  systems.
- `GET /api/v1/health/ready` probes PostgreSQL, Redis, and the configured object-storage bucket in
  parallel. Any failed dependency produces HTTP 503 and preserves per-dependency status.

This separation keeps an infrastructure outage from causing an orchestrator to endlessly restart a
healthy process while still removing an incapable instance from traffic.

## Evolution rules

Extraction into services is considered only when measurements show an independent scaling,
reliability, deployment, or ownership need. Candidate modules include Feed, Media Processing,
Notifications, and Messaging. Extraction should move a module's application boundary and event
contracts, not require callers to understand its persistence internals.

OpenTelemetry libraries are postponed until spans/metrics have a concrete export destination. The
current request/correlation model and structured logs preserve the context needed to add tracing.

## Dependency policy

Dependencies are exactly pinned and the lockfile is committed. A library is added only when current
code uses it. This is why Phase 0 excludes TanStack Query, React Hook Form, Zustand, Playwright, and
FFmpeg. TypeScript is pinned to 5.9 because the selected lint parser supports TypeScript versions
below 6.1. ESLint is pinned to the latest 9.x release because the React plugin currently bundled by
the Next.js lint preset is not compatible with ESLint 10.

Workspace packages are injected so pnpm can package API and worker deployments into self-contained
production directories. `syncInjectedDepsAfterScripts` refreshes their copies after shared-package
builds, keeping local consumers and container deploy output consistent without shipping development
dependencies.
