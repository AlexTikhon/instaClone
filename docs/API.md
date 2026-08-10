# API

## Conventions

- Base path: `/api/v1`
- OpenAPI UI: `/docs`
- OpenAPI JSON: `/docs/openapi.json`
- Media bytes will use direct S3-compatible uploads rather than passing through the API.
- Authenticated identity will come from verified credentials, never a browser-provided user ID.

## Platform endpoints

| Method | Path                   | Success    | Purpose                                         |
| ------ | ---------------------- | ---------- | ----------------------------------------------- |
| GET    | `/api/v1/health/live`  | 200        | Process liveness                                |
| GET    | `/api/v1/health/ready` | 200 or 503 | PostgreSQL, Redis, and object-storage readiness |

All responses include `X-Request-ID`. A valid incoming value is propagated; invalid or missing values
are replaced.

## Error envelope

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Cannot GET /api/v1/example",
    "requestId": "9ce3eb5e-398c-4c97-b93f-e9f73f367e5d"
  }
}
```

Clients branch on `code`, never `message`. Server errors expose a safe generic message. Validation
details may later appear in `details` but must not contain secrets or internal stack information.

## Pagination policy

Feed, comments, follower lists, notifications, and messages will use opaque cursors backed by a stable
ordering such as `(createdAt, id)`. Cursor internals are not a client contract and may be signed or
versioned later.
