# ADR 0008: Rotating cookie sessions

- Status: accepted
- Date: 2026-08-10

## Context

The browser needs persistent authentication without exposing bearer material to JavaScript. Session
revocation and refresh-token replay must be observable at the API boundary, and profile writes must
not trust a user identifier supplied by the browser.

## Decision

Passwords use Argon2id. The API issues a 15-minute HS256 access token in an HTTP-only cookie and an
opaque 30-day refresh token in a narrower-path HTTP-only cookie. The signing secret and refresh-token
pepper are independent configuration values. Every protected request verifies the access token and
checks its database session, so logout, account disablement, expiry, and replay revocation take effect
immediately.

Only a SHA-256 HMAC of each refresh token is stored. Rotation atomically consumes the presented row
and creates its replacement without extending the session's absolute expiry. Reusing any consumed
token revokes the whole session. Historical token rows remain through the session lifetime to support
replay detection and may be deleted after their parent session expires.

Authentication cookies use `HttpOnly`, `SameSite=Strict`, explicit paths, bounded lifetimes, and
`Secure` when `AUTH_COOKIE_SECURE=true`. Browser mutations require a signed double-submit token in
the readable `ic_csrf` cookie and `X-CSRF-Token` header. TLS deployments must enable secure cookies.

Profile updates are addressed only as `/profiles/me`; the authenticated user and session are derived
from the access cookie. Public profile lookup exposes the profile contract, not credential, email,
session, or persistence metadata.

## Consequences

Database-backed checks add one indexed lookup to authenticated requests but provide immediate
revocation with simple semantics. Stateful refresh-token history requires cleanup after expiry.
Changing credentials later must revoke all active sessions and use the existing `PASSWORD_CHANGE`
reason. Multi-device use creates one independently revocable session per login.
