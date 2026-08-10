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

| Method | Path                           | Auth / CSRF          | Purpose                              |
| ------ | ------------------------------ | -------------------- | ------------------------------------ |
| GET    | `/api/v1/auth/csrf`            | none                 | Issue a signed double-submit token   |
| POST   | `/api/v1/auth/register`        | CSRF                 | Create user, credential, and profile |
| POST   | `/api/v1/auth/login`           | CSRF                 | Create a new device session          |
| POST   | `/api/v1/auth/refresh`         | refresh cookie, CSRF | Rotate refresh and access cookies    |
| POST   | `/api/v1/auth/logout`          | refresh cookie, CSRF | Revoke and clear the session         |
| GET    | `/api/v1/auth/me`              | access cookie        | Read the authenticated identity      |
| POST   | `/api/v1/auth/email/verify`    | CSRF                 | Consume a verification token         |
| POST   | `/api/v1/auth/email/resend`    | access cookie, CSRF  | Send a replacement verification link |
| POST   | `/api/v1/auth/password/forgot` | CSRF                 | Request a password reset             |
| POST   | `/api/v1/auth/password/reset`  | CSRF                 | Consume a password-reset token       |
| POST   | `/api/v1/auth/password/change` | access cookie, CSRF  | Change password and revoke sessions  |
| GET    | `/api/v1/auth/sessions`        | access cookie        | List active device sessions          |
| DELETE | `/api/v1/auth/sessions/:id`    | access cookie, CSRF  | Revoke one owned session             |
| DELETE | `/api/v1/auth/sessions`        | access cookie, CSRF  | Revoke all owned sessions            |
| PATCH  | `/api/v1/profiles/me`          | access cookie, CSRF  | Update only the caller's profile     |
| GET    | `/api/v1/profiles/:name`       | none                 | Read a public profile                |

Registration and profile bodies use strict schemas; unknown fields are rejected. Access and refresh
tokens are never returned in JSON. Browser clients send credentials and the `X-CSRF-Token` header on
mutations.

Registration, login, refresh, verification resend, and password-recovery routes use Redis-backed
fixed-window limits. Password-forgot always returns the same accepted response, whether or not the
email belongs to an account.

## Social Graph endpoints

Social mutations require a verified email, access cookie, and CSRF token. Actor identity always
comes from the access session; request bodies cannot select a follower, request owner, or blocker.

| Method | Path                                                 | Purpose                                      |
| ------ | ---------------------------------------------------- | -------------------------------------------- |
| POST   | `/api/v1/social/follows/:targetId`                   | Follow publicly or request a private account |
| DELETE | `/api/v1/social/follows/:targetId`                   | Unfollow or cancel an outgoing request       |
| GET    | `/api/v1/social/follow-requests`                     | List the caller's incoming requests          |
| POST   | `/api/v1/social/follow-requests/:requesterId/accept` | Accept an incoming request                   |
| DELETE | `/api/v1/social/follow-requests/:requesterId`        | Decline an incoming request                  |
| POST   | `/api/v1/social/blocks/:targetId`                    | Block a user and remove relationships        |
| DELETE | `/api/v1/social/blocks/:targetId`                    | Unblock a user                               |

Follow and block operations are idempotent. A follow response is either `following` or `requested`.
Blocked relationships return the same unavailable response as an inaccessible target so block state
is not disclosed.

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
