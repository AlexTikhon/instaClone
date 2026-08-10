# InstaClone Engineering Lab

An educational, production-oriented social application built incrementally as a TypeScript modular
monolith. Phase 1 adds secure authentication, rotating sessions, and owned profiles to the Phase 0
platform foundation.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker with Compose

## Start locally

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis minio minio-init
pnpm dev
```

Apply the committed database migration before first use:

```bash
pnpm --filter @instaclone/api db:migrate:deploy
```

- Web: `http://localhost:3000`
- API liveness: `http://localhost:4000/api/v1/health/live`
- API readiness: `http://localhost:4000/api/v1/health/ready`
- OpenAPI UI: `http://localhost:4000/docs`
- MinIO console: `http://localhost:9001`

To run the complete containerized stack, use `docker compose up --build`.
All published ports have overrides in `.env.example`, so local conflicts can be resolved without
editing Compose.

## Validation

```bash
pnpm validate
```

Architecture and decision rationale live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
ADRs under [`docs/ADR`](docs/ADR).
