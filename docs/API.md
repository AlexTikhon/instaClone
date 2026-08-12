# API

## Messaging (Phase 8)

All reads require the authenticated access cookie. Conversation creation and send additionally
require verified email and CSRF; read watermark mutation requires CSRF. IDs are UUIDs and all request
objects are strict.

- `POST /api/v1/conversations` with `{ participantUserId }` creates or returns the canonical 1:1
  conversation. Self targets return `SELF_CONVERSATION_NOT_ALLOWED`; unavailable/blocked targets are
  uniformly `USER_NOT_AVAILABLE`.
- `GET /api/v1/conversations?cursor=&limit=20` returns snapshot-paginated summaries with peer,
  preview, activity time, unread count, and blocked/composer state.
- `GET /api/v1/conversations/:conversationId` returns one participant-owned summary.
- `GET /api/v1/conversations/:conversationId/messages?before=&limit=30` returns newest-first message
  pages. The opaque cursor is valid only for that conversation.
- `POST /api/v1/conversations/:conversationId/messages` accepts `{ text, clientMessageId }`. Text is
  preserved, must contain a non-whitespace character, and is bounded to 4,000 characters. Exact
  retries return the first message; different use of the same key returns
  `CLIENT_MESSAGE_ID_REUSED`. The IP-derived Redis bucket permits 60 send attempts per minute.
- `POST /api/v1/conversations/:conversationId/read` accepts `{ messageId }` and returns the monotonic
  `lastReadSequence` and remaining `unreadCount`.

Every ID-addressed operation predicates on authenticated membership. Foreign and missing
conversations both return `CONVERSATION_NOT_FOUND`. New sends to blocked or unavailable peers return
`MESSAGING_FORBIDDEN`; history remains readable.

Messages contain `id`, `conversationId`, `senderId`, numeric safe-range `sequence`, `text`,
`clientMessageId`, and `createdAt`. The server realtime message is
`{ event: "MESSAGE_CREATED", data: { conversationId, messageId, senderId, sequence, occurredAt } }`;
it intentionally omits text and recipient identity.

## Search and Explore

Both discovery endpoints require an authenticated access-cookie session. They are bounded to 120
requests per IP-derived bucket per minute and never accept viewer identity from request data.

| Method | Path                                     | Behavior                               |
| ------ | ---------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/search/users?q=&limit=&cursor=` | Ranked username/display-name discovery |
| GET    | `/api/v1/explore?limit=&cursor=`         | Snapshot-ranked visible post discovery |

User search accepts a normalized query of 2–60 characters and pages at most 25 results. Its response
is `{ users, nextCursor, hasMore }`. A user contains only `userId`, username, display name, privacy,
and the caller-relative `self | none | following | requested` state. Email, security state,
moderation state, and block direction are never returned. Ranking is exact username, username
prefix, exact display name, display-name prefix, username contains, then display-name contains.
Wildcards are literal. Invalid or query-mismatched cursors use `INVALID_SEARCH_CURSOR`.

Explore pages at most 30 items and returns `{ items, nextCursor, hasMore, snapshotAt }`. Items reuse
the post plus engagement shape from Home. A first page fixes score inputs to `snapshotAt`, then orders
by weighted likes/comments, seven-day freshness, creation time, and post ID. Invalid cursors use
`INVALID_EXPLORE_CURSOR`. Own posts, deleted posts, inaccessible private authors, both block
directions, unavailable accounts, and unready media are excluded.

## Stories

All actor/viewer identity comes from the authenticated cookie session. Creation accepts the strict
body `{ "mediaAssetId": "uuid" }`; author and expiration are never client fields.

| Method | Path                                   | Behavior                                                     |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| POST   | `/api/v1/stories`                      | Create a 24-hour image Story from owned READY media          |
| GET    | `/api/v1/stories`                      | Unseen-first self/following author tray (maximum 100 groups) |
| GET    | `/api/v1/stories/users/:authorId`      | Active visible author sequence, oldest-first                 |
| GET    | `/api/v1/stories/:storyId`             | One active visible Story                                     |
| PUT    | `/api/v1/stories/:storyId/view`        | Idempotently record the authenticated viewer's first view    |
| DELETE | `/api/v1/stories/:storyId`             | Soft-delete an owned Story                                   |
| GET    | `/api/v1/stories/:storyId/viewers?...` | Author-only retained viewer page, newest-first               |

Viewer pages use opaque `(viewedAt, viewerId)` cursors and return `{ viewers, nextCursor, hasMore }`.
Each viewer exposes only id, username, display name, and viewed time. An author may inspect viewers
after expiration or manual deletion while the Story record is in 30-day retention. Public/direct
Story reads and new views stop immediately at deletion or expiration. Missing, inaccessible,
private, blocked, disabled-author, foreign viewer-list, and expired public identifiers all use
`STORY_NOT_FOUND`. Cursor failures use `INVALID_STORY_CURSOR`; creation may use
`STORY_MEDIA_NOT_OWNED`, `STORY_MEDIA_NOT_READY`, `INVALID_STORY_MEDIA`, or `STORY_LIMIT_REACHED`.

## Notifications

All notification ownership comes from the authenticated access-cookie session; no endpoint accepts a
recipient ID.

| Method | Path                                   | Behavior                                       |
| ------ | -------------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/notifications?limit=&cursor=` | descending keyset page plus total unread count |
| PUT    | `/api/v1/notifications/:id/read`       | idempotently marks one owned row read          |
| PUT    | `/api/v1/notifications/read-all`       | marks only the current user's unread rows      |

The list response is `{ items, nextCursor, hasMore, unreadCount }`; the opaque cursor represents
`(createdAt, id)`. Invalid cursors use `INVALID_NOTIFICATION_CURSOR`. Missing and foreign IDs both
use `NOTIFICATION_NOT_FOUND`, preventing an ownership oracle. Both PUT operations require the normal
CSRF cookie/header pair and are safe to repeat.

Each item contains only notification identity/type/timestamps, a minimal render actor, and nullable
post/comment target identifiers with `contentAvailable`. It never returns email, sessions, security
fields, raw Prisma records, or whole domain snapshots.

The native WebSocket endpoint is `/api/v1/realtime`. Server messages use:

```json
{
  "event": "NOTIFICATION_CREATED",
  "data": { "notification": {} }
}
```

The embedded notification follows the same strict response contract as REST. This message is an
online hint, not a replay or delivery guarantee. Clients refetch the REST collection whenever a
connection opens or reopens.

## Phase 4 feed and engagement endpoints

| Method | Path                                 | Purpose                            |
| ------ | ------------------------------------ | ---------------------------------- |
| GET    | `/api/v1/feed?limit=&cursor=`        | Chronological self/following feed  |
| PUT    | `/api/v1/posts/:postId/like`         | Idempotently like a visible post   |
| DELETE | `/api/v1/posts/:postId/like`         | Idempotently unlike a visible post |
| PUT    | `/api/v1/posts/:postId/save`         | Privately save a visible post      |
| DELETE | `/api/v1/posts/:postId/save`         | Idempotently remove a private save |
| POST   | `/api/v1/posts/:postId/comments`     | Create a top-level comment         |
| GET    | `/api/v1/posts/:postId/comments?...` | Page active comments newest-first  |
| DELETE | `/api/v1/comments/:commentId`        | Soft-delete the caller's comment   |
| DELETE | `/api/v1/posts/:postId`              | Soft-delete the caller's post      |

Feed returns `{ items, nextCursor, hasMore }`. Items contain post/author/media, `likeCount`, active
`commentCount`, `viewerHasLiked`, and private `viewerHasSaved`; comment lists and save counts are not
embedded. Malformed bounded cursors produce `INVALID_FEED_CURSOR` or `INVALID_COMMENT_CURSOR`.

Every interaction reapplies post visibility. Hidden, disabled, blocked, private, or deleted content
produces `POST_NOT_FOUND`. Comment bodies are strict, trimmed, nonempty, and at most 1,000 characters.

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
| GET    | `/api/v1/social/follow-requests?limit=&cursor=`      | Cursor-page the caller's incoming requests   |
| POST   | `/api/v1/social/follow-requests/:requesterId/accept` | Accept an incoming request                   |
| DELETE | `/api/v1/social/follow-requests/:requesterId`        | Decline an incoming request                  |
| POST   | `/api/v1/social/blocks/:targetId`                    | Block a user and remove relationships        |
| DELETE | `/api/v1/social/blocks/:targetId`                    | Unblock a user                               |

Follow and block operations are idempotent. A follow response is either `following` or `requested`.
Blocked relationships return the same unavailable response as an inaccessible target so block state
is not disclosed.

Incoming request pages are bounded to 50 and ordered by `(createdAt DESC, requesterId DESC)`. The
opaque response cursor contains both stable ordering fields. Acceptance rechecks that both accounts
remain active/profile-backed and that no block now prevents the edge. Accept, decline, follow,
unfollow, block, and unblock are retry-safe for their resulting state.

## Media and Posts endpoints

Media and post mutations require verified email, access cookie, and CSRF. Reads require an access
session. No request accepts an owner/author user ID for a mutation.

| Method | Path                              | Purpose                                             |
| ------ | --------------------------------- | --------------------------------------------------- |
| POST   | `/api/v1/media/uploads`           | Authorize a bounded image and return a signed PUT   |
| POST   | `/api/v1/media/:mediaId/finalize` | HEAD-verify the owned object and queue processing   |
| GET    | `/api/v1/media/:mediaId`          | Poll the caller's media lifecycle                   |
| POST   | `/api/v1/posts`                   | Atomically create an authored post and outbox event |
| GET    | `/api/v1/posts/:postId`           | Read one visible post                               |
| GET    | `/api/v1/posts?authorId=&...`     | Cursor-page one visible author timeline             |

Upload initialization accepts only strict `{ kind, mimeType, sizeBytes }` input. Phase 3 accepts
JPEG, PNG, and WebP images up to 10 MiB. The response includes a five-minute PUT URL and required
headers but never an object key or credential. Finalization accepts only an empty strict object.

Post creation accepts a caption of at most 2,200 characters and one to ten unique media asset IDs.
Every asset must be owned by the actor, `READY`, and unattached. Author timelines use
`(createdAt DESC, id DESC)` keyset pagination and do not represent a feed. Deleted posts, disabled
authors, blocks in either direction, and private-account follow policy are enforced.

Phase 3-specific codes include `MEDIA_NOT_FOUND`, `MEDIA_NOT_OWNED`, `MEDIA_NOT_READY`,
`MEDIA_UPLOAD_INVALID`, `INVALID_POST_MEDIA`, and `POST_NOT_FOUND`. Storage keys, worker failure
details, and signed URL internals are not API fields.

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

Posts and follow requests use opaque cursors now. Feed, comments, follower lists, notifications, and messages will use opaque cursors backed by a stable
ordering such as `(createdAt, id)`. Cursor internals are not a client contract and may be signed or
versioned later.

Relationship-state, follower/following-count, and follower/following-list HTTP read models are
intentionally postponed. Phase 3 needs only an internal Social Graph visibility decision for post
reads; adding broader graph APIs now would create unused contracts.
