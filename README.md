# InstaClone Engineering Lab

An educational, production-oriented social application built incrementally as a TypeScript modular
monolith. Phase 3 adds secure direct image uploads, bounded asynchronous processing, authored posts,
cursor reads, and a transactional outbox to the authentication, profile, and Social Graph foundation.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker with Compose

## Start locally

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis minio minio-init mailpit
pnpm dev
```

Apply the committed database migrations before first use:

```bash
pnpm --filter @instaclone/api db:migrate:deploy
```

- Web: `http://localhost:3000`
- API liveness: `http://localhost:4000/api/v1/health/live`
- API readiness: `http://localhost:4000/api/v1/health/ready`
- OpenAPI UI: `http://localhost:4000/docs`
- MinIO console: `http://localhost:9001`
- Mailpit inbox: `http://localhost:8025`

To run the complete containerized stack, use `docker compose up --build`. All published ports have
overrides in `.env.example`, so local conflicts can be resolved without editing Compose.

The create-post workflow needs the worker process (`pnpm --filter @instaclone/workers dev`) or the
complete Compose stack. The browser uploads bytes directly to the signed MinIO URL; the API does not
proxy file bodies.

## Validation

```bash
pnpm validate
```

The PostgreSQL integration suite is enabled in CI. To run it locally after applying migrations, set
`RUN_POSTGRES_INTEGRATION=true` and `TEST_DATABASE_URL` to a disposable PostgreSQL database before
running the API tests.

Architecture and decision rationale live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
ADRs under [`docs/ADR`](docs/ADR).
