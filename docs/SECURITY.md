# Security

## Moderation controls (Phase 9)

Normal report creation cannot enumerate targets: the server validates the target through the same
account/post/Story visibility semantics used by product reads and returns one not-found code for
missing, blocked, private/inaccessible, self-owned, expired, deleted, or moderator-removed targets.
Strict Zod bodies, bounded details, active-duplicate uniqueness, and a rate-limit bucket constrain
basic report abuse.

Every case endpoint uses both database-backed authentication and a server-side role guard. Hiding
the `/moderation` navigation link is convenience only. Mutation routes also require verified email
and the existing signed double-submit CSRF pair. Moderator notes, report details, reporter IDs, and
audit history appear only in privileged case detail; logs and outbox payloads contain identifiers
and action names only.

Resolution row-locks the case, validates the state/action, and commits enforcement, decision, audit,
outbox, and closure atomically. Database uniqueness prevents a second decision, while the immutable
audit trigger prevents ordinary tampering. Account suspension sets `disabledAt` and revokes every
active session in the same transaction; access-token and WebSocket revalidation already re-read
that state. Public profile lookup now requires authentication and applies disabled-account and
either-direction block filtering, closing the earlier direct-profile availability gap.

## Direct messaging controls (Phase 8)

Every conversation and history query predicates on current-session membership; UUID knowledge does
not disclose a foreign conversation. Create/send identities come only from authentication, strict
contracts reject extra fields, text is bounded to 4,000 characters and checked again by PostgreSQL,
and message bodies are excluded from outbox payloads, Redis, WebSocket hints, and structured logs.

The Social Graph interaction policy checks both block directions and active profiles while holding a
canonical transaction-scoped pair lock. Block/unblock use the same lock. Therefore a racing send is
either committed wholly before the block or rejected after it; subsequent sends cannot cross the
block. Existing history remains visible and the API exposes a blocked composer state only to an
existing participant. New-conversation block failures retain the Social Graph's unavailable-target
behavior.

Database uniqueness, rather than memory, owns client-message replay protection. Exact retries can
recover their prior result after a network timeout (including after a later block), while key reuse
with other content or a different conversation is rejected. Send attempts reuse the platform's
Redis-backed 60/minute request limiter. Read watermarks use `GREATEST` and cannot move backward or
advance to an inaccessible message. Authenticated WebSockets retain origin validation, HTTP-only
cookie/session revalidation, and multi-socket fan-out; realtime signals contain no message text.

## Discovery

Search and Explore require authentication, enforce bounded query/page sizes, and apply a 120 request
per minute IP-derived bucket. Search text is not included in structured application logs. SQL values
are parameterized and LIKE metacharacters are escaped as literal input. Both-direction blocks and
account availability are applied inside candidate queries; Explore additionally reapplies the shared
post visibility policy during hydration. Missing and excluded data is represented by omission, never
by a block/private-state diagnostic.

## Story controls (Phase 6)

The create schema accepts only `mediaAssetId`; author identity comes from the authenticated session,
and PostgreSQL sets the lifetime. Media verifies actor ownership, READY state, and IMAGE kind before
creation. The maximum of 100 simultaneously active Stories is serialized per author with a
transaction-scoped advisory lock, preventing concurrent requests from bypassing the count.

One Stories access policy is embedded in tray, sequence, direct read, and view-recording SQL. It
excludes soft-deleted/expired Stories, disabled or profile-less authors, either-direction blocks, and
private authors without an accepted follow. Tray adds self-or-followed membership. UUID knowledge
does not bypass policy and inaccessible reads return `STORY_NOT_FOUND`.

`PUT /stories/:id/view` derives the viewer from authentication and conditionally inserts only from an
active visible Story query. Database uniqueness makes retries and multiple tabs idempotent, and the
author cannot create a self-view row. Viewer lists predicate ownership on the authenticated author,
hide foreign/missing IDs identically, omit disabled viewer identities, paginate, and never expose
email or security fields. Expired/deleted retained rows remain author-inspectable but accept no new
views. Existing CSRF and verified-email guards protect Story mutations. General authenticated
content-mutation rate limiting remains a future platform hardening item; the active Story cap bounds
creation payload growth now.

## Notification and realtime controls (Phase 5)

Notification reads and updates always predicate on the current authenticated user. Foreign IDs are
indistinguishable from missing IDs, read operations are idempotent, and unread counts cannot be
requested for another user. Projection suppresses self-notifications on the server.

The WebSocket handshake accepts no user ID or access token in its URL. It reads the existing
HTTP-only `ic_access` cookie, validates the signed token, and rechecks session ownership, expiry,
revocation, and disabled-account state in PostgreSQL through the same authenticator used by HTTP.
The handshake Origin must match the configured CORS allowlist to prevent cross-site WebSocket
hijacking. Open sockets revalidate credentials every minute and close when authentication is no
longer valid.

Redis Pub/Sub messages originate from the internal worker and are strictly schema-validated by API
instances. Redis is not exposed as notification storage. Logs include event, notification,
recipient, correlation, connection-count, and delivery-count identifiers, but never cookies,
tokens, socket secrets, comment text, or notification contents.

WebSocket delivery is intentionally not guaranteed. Network changes, process restarts, and Pub/Sub
loss are recovered by recipient-owned REST reads on connect/reconnect. Future metrics can include
`notifications_created_total`, `notification_worker_failures_total`, `realtime_connections`,
`realtime_delivery_attempts`, and notification API latency; Phase 5 does not add a metrics stack.

## Feed and engagement controls (Phase 4)

A single post-access policy is used by direct reads, timelines, Feed, likes, comments, and saves. It
excludes deleted posts, disabled/profile-less authors, blocks in either direction, and inaccessible
private content. Uniform `POST_NOT_FOUND` behavior avoids visibility and block oracles.

Composite keys make likes and private saves concurrency-safe. Saver identities and save counts are
never exposed. Comment text is not logged; feed logs contain identifiers, counts, and timing only.
Deletion ownership comes from the authenticated actor. Media and engagement survive soft post
deletion for a future bounded asynchronous retention policy.

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

## Media and post controls (Phase 3)

The API issues five-minute presigned PUTs only after authenticated/verified-email policy and strict
declared MIME/size checks. It generates both `userId` and
`users/{userId}/media/{mediaId}/original`; the browser controls neither ownership nor a key segment.
Phase 3 accepts only JPEG, PNG, and WebP declarations up to 10 MiB. SVG and video processing are not
accepted.

Finalization resolves the owned database asset and HEADs that exact key. Object existence, positive
bounded size, exact authorized size, and stored Content-Type must match before `UPLOADED`. This
metadata is verified storage metadata, not decoded truth: S3 Content-Type can still originate from
the upload request. Only the worker's magic-byte decode establishes format, width, and height.

Workers bound compressed bytes, decoded pixels (40 million), each dimension (12,000), accepted
formats, and thumbnail dimensions. Originals are immutable; WebP thumbnails use a separate
deterministic key. Invalid bytes transition to a safe operational failure code, while storage and
database outages retry. MinIO's server-level CORS allowlist explicitly names the local web origin
(production must inject its own allowlist), and responses receive
short-lived signed GET URLs; credentials and raw storage keys are never API response fields.

Posts require actor-owned `READY` and unattached assets. Disabled authors, soft-deleted posts,
private-account follow policy, and blocks in either direction are checked on reads. Inaccessible
content returns the same `POST_NOT_FOUND` response to avoid disclosing block/private state.

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
broader abuse controls remain outstanding. Malware scanning, abandoned-upload garbage collection,
signed-URL CDN delivery, EXIF stripping policy beyond the generated thumbnail, video validation and
transcoding, and production bucket lifecycle rules remain intentionally postponed.
