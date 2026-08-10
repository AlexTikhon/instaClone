# Security

## Phase 0 controls

- environment schemas fail startup when required values are missing or malformed;
- secrets are not committed, and `.env` variants are ignored;
- structured logs redact authorization, cookies, passwords, tokens, secrets, and `Set-Cookie`;
- inbound request IDs are length- and character-bounded before logging or reflection;
- Helmet sets baseline browser security headers;
- CORS uses an explicit environment-controlled allowlist;
- unexpected server errors return safe messages without stack traces;
- containers run application processes as the unprivileged `node` user.

The Compose credentials are development-only defaults. Any shared or production environment must
inject distinct managed secrets, terminate TLS, and restrict database/Redis/MinIO network exposure.

## Authentication and session controls (Phase 1)

Passwords use Argon2id with explicit memory, time, and parallelism parameters. Short-lived access
tokens and opaque refresh tokens use separate secrets and HTTP-only, strict same-site cookies.
Authenticated requests check the database session as well as the access-token signature.

Refresh material is HMAC-hashed at rest. A refresh transaction consumes one token and creates its
replacement without extending the session's absolute lifetime. Reuse of any consumed token revokes
the session. Logout also revokes the database session before clearing cookies.

All browser mutations require a signed double-submit CSRF value in both `ic_csrf` and
`X-CSRF-Token`. Set `AUTH_COOKIE_SECURE=true` for every TLS deployment; the false value in Compose is
only for local HTTP development. Access, refresh, and pepper secrets must be replaced outside local
development.

Profile writes are available only at `/profiles/me`, with ownership derived from the verified
session. Browser-provided identity fields are rejected by strict request schemas. Private-account,
follow-request, and block policies remain assigned to the social-graph phase where those resources
exist.

## Upload plan (Phase 3)

The API will issue short-lived presigned uploads after checking authenticated policy, declared MIME
type, size, and object-key ownership. Finalization must verify the stored object rather than trusting
client metadata. Media workers decode content defensively, bound FFmpeg resources, and write derived
variants to separate keys. Object buckets remain non-public; delivery uses controlled URLs/CDN policy.

## Outstanding hardening

Rate limiting, email verification, password reset/change, MFA, session-management UI, audit events,
content security policy tuning, and abuse controls remain outstanding. Authentication endpoints
should not be exposed to the internet until rate limiting and managed production secrets are in
place.
