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
session. Browser-provided identity fields are rejected by strict request schemas.

## Upload plan (Phase 3)

The API will issue short-lived presigned uploads after checking authenticated policy, declared MIME
type, size, and object-key ownership. Finalization must verify the stored object rather than trusting
client metadata. Media workers decode content defensively, bound FFmpeg resources, and write derived
variants to separate keys. Object buckets remain non-public; delivery uses controlled URLs/CDN policy.

## Account security controls (Phase 1.1)

Email-verification and password-reset links contain random one-time tokens. Only purpose-separated
HMAC hashes are stored, tokens expire, replacement requests invalidate earlier unused tokens, and
password reset revokes every active session. Password changes verify the current Argon2id credential
and also revoke all sessions.

Users can inspect active sessions with creation, last-use, IP, and user-agent context, revoke an
individual owned session, or revoke all sessions. Authentication lifecycle outcomes are retained as
append-only audit events. A periodic cleanup removes expired or revoked sessions, stale action
tokens, and audit events past the configured retention period.

Registration, login, refresh, resend, and recovery are rate-limited with Redis-backed fixed windows.
Production startup rejects insecure cookies, weak placeholder authentication secrets, reused signing
and hashing secrets, and non-HTTPS public web URLs. SMTP carries verification and recovery mail;
Mailpit provides a local-only inbox.

## Social Graph authorization (Phase 2)

Social mutations require both an authenticated session and a verified email. The current session is
the only source of actor identity. Self-follow and self-block transitions are rejected, only the
private-account owner can accept or decline an incoming request, and database constraints provide a
second line of defense against self-directed edges.

Blocks are checked in both directions and deliberately surface as an unavailable target. Creating a
block atomically removes follows and pending requests in both directions. Serializable transactions
and composite primary keys keep retries idempotent and prevent duplicate edges.

## Outstanding hardening

MFA, session-management UI, content security policy tuning, adaptive/breached-password checks, and
broader abuse controls remain outstanding.
