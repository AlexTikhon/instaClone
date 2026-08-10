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

## Authentication and profile endpoints

| Method | Path                     | Auth / CSRF          | Purpose                              |
| ------ | ------------------------ | -------------------- | ------------------------------------ |
| GET    | `/api/v1/auth/csrf`      | none                 | Issue a signed double-submit token   |
| POST   | `/api/v1/auth/register`  | CSRF                 | Create user, credential, and profile |
| POST   | `/api/v1/auth/login`     | CSRF                 | Create a new device session          |
| POST   | `/api/v1/auth/refresh`   | refresh cookie, CSRF | Rotate refresh and access cookies    |
| POST   | `/api/v1/auth/logout`    | refresh cookie, CSRF | Revoke and clear the session         |
| GET    | `/api/v1/auth/me`        | access cookie        | Read the authenticated identity      |
| PATCH  | `/api/v1/profiles/me`    | access cookie, CSRF  | Update only the caller's profile     |
| GET    | `/api/v1/profiles/:name` | none                 | Read a public profile                |

Registration and profile bodies use strict schemas; unknown fields are rejected. Access and refresh
tokens are never returned in JSON. Browser clients send credentials and the `X-CSRF-Token` header on
mutations.

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
