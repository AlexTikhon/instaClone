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

## Authentication plan (Phase 1)

Passwords will use a memory-hard password hash with calibrated parameters. Short-lived access tokens
and rotating refresh sessions will be evaluated against an HTTP-only secure-cookie design. Refresh
token material must be hashed at rest, rotated atomically, and support reuse detection/revocation.
CSRF protection will match the selected cookie strategy.

Backend authorization will enforce ownership, private-account, follow-request, and block policies at
application boundaries. Browser-provided identity fields are never authoritative.

## Upload plan (Phase 3)

The API will issue short-lived presigned uploads after checking authenticated policy, declared MIME
type, size, and object-key ownership. Finalization must verify the stored object rather than trusting
client metadata. Media workers decode content defensively, bound FFmpeg resources, and write derived
variants to separate keys. Object buckets remain non-public; delivery uses controlled URLs/CDN policy.

## Outstanding hardening

Rate limiting, CSRF enforcement, authentication, authorization policies, dependency scanning, audit
events, content security policy tuning, and abuse controls are intentionally assigned to the phases
where their request flows exist. Their absence means Phase 0 is a development foundation, not yet an
internet-ready product.
