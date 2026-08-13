# ADR 0015: Reels and production video processing V1

- Status: Accepted
- Date: 2026-08-12

## Context

InstaClone already has direct object-storage uploads, a MediaAsset lifecycle, PostgreSQL processing
leases, transactional outbox delivery, BullMQ workers, signed image presentation, shared content
access policies, and relational moderation targets. Reels needs a substantially heavier binary
pipeline, but neither product ownership nor observed load justifies a media microservice. Treating an
uploaded MP4 as production-ready would trust client metadata, omit adaptive delivery, and make
privacy enforcement for nested HLS requests incorrect.

## Decision

Reels is a separate product domain in the TypeScript modular monolith. It owns Reel identity,
author, caption, publication, chronological discovery, soft deletion, and moderation state. Media
continues to own upload intents, source objects, validation, processing state, derived files,
metadata, and presentation delivery. Reels never calls S3/MinIO. One Reel has one unique READY VIDEO
MediaAsset; V1 does not generalize Post interactions or add Reel likes/comments.

### Upload and lifecycle

The browser requests the existing discriminated Media upload intent and uploads directly to the
presigned S3-compatible URL. V1 accepts `video/mp4` and `video/quicktime`, a declared and stored size
of at most 150 MiB, and a maximum probed duration of 90 seconds. The API's MIME/size checks improve
UX and constrain the signed upload. They are not content validation.

Finalization HEADs the object, requires exact declared content type and length, then atomically moves
`PENDING_UPLOAD -> UPLOADED` and writes `VIDEO_UPLOADED` to the outbox. The existing state machine is
unchanged: `PENDING_UPLOAD -> UPLOADED -> PROCESSING -> READY`, with terminal validation failure at
`PROCESSING -> FAILED`. Transient failures return an owned asset to `UPLOADED` so BullMQ can retry.
Clients never receive playback for a non-READY asset.

### Queue, claim, lease, and idempotency

The outbox publisher routes video events to `video-processing`, separate from short domain events.
The deterministic job ID is `video-process-<assetId>-v1`; it has three attempts with exponential
backoff. Queue deduplication is an optimization. PostgreSQL is correctness: a conditional claim
accepts UPLOADED or an expired PROCESSING lease, READY/FAILED events no-op, a heartbeat renews the
90-second lease, and finalization requires the current worker/attempt ID. A stale worker cannot
overwrite a later claim.

Video concurrency defaults to one and is capped at four by configuration. This worker role remains
the same codebase and database boundary; it is a deployment scaling boundary, not a network service.

Each claim uses an opaque UUID attempt ID. Local work is
`<os-temp>/instaclone-video/<assetId>/<attemptId>` with server-controlled filenames. Source download
and derived upload use streams. The directory is removed in `finally`; a 150 MiB source plus all
renditions means operators must provision several times the source limit per concurrent job.

Attempt outputs use
`users/<ownerId>/media/<assetId>/video/v1/attempts/<attemptId>/...`. Reclaim cleans the prior attempt,
and a failed current attempt cleans only its own prefix. Cleanup failure can leave an inaccessible
orphan but cannot delete a newer result. A future retention job will reconcile orphan prefixes.

### ffprobe and FFmpeg

Worker images install OS-level FFmpeg 7 or later. No executable is downloaded at runtime. Child
processes use `spawn(executable, argumentArray, {shell:false})`; users never control paths, output
names, or command strings. stderr is bounded to 32 KiB in memory and only a short diagnostic reaches
an exception. The full job and poster command have kill timeouts; graceful worker shutdown waits for
BullMQ jobs.

`ffprobe` JSON is parsed into selected fields rather than stored wholesale. V1 requires exactly one
real video stream, at most one audio stream, a supported MP4/MOV container and bounded codec,
duration, dimensions, and frame rate. Display width/height account for 90/270-degree rotation.
FFmpeg autorotation normalizes pixels before scaling. Silent videos are valid; present audio becomes
two-channel 128 kbps AAC.

V1 uses H.264 Main/yuv420p and a fit-within, aspect-preserving ladder bounded by portrait/landscape
boxes 360x640, 720x1280, and 1080x1920. It never enlarges a source, removes duplicate source-sized
outputs, and does not crop. One FFmpeg invocation splits the decoded stream into all renditions. A
four-second GOP, disabled scene-cut keyframes, forced keyframes at four-second boundaries, and one
HLS muxer invocation align variants for switching.

HLS uses MPEG-TS segments for broad, simple V1 browser compatibility. Each rendition has `index.m3u8`
and `segment-00000.ts` files; `master.m3u8` references available renditions. Fragmented MP4/CMAF,
DASH, AV1, VP9, DRM, live ingest, subtitles, editing, and audio remixing are deferred. A deterministic
poster at `min(1 second, 10% of duration)` avoids relying on a commonly black first frame and is
encoded as bounded WebP.

PostgreSQL stores one MediaVariant row for the master, each rendition playlist, and the poster. HLS
segments remain storage implementation details inferred beneath the rendition prefix. The worker
uploads segments, rendition manifests, poster, and master in that order. Only afterward does one
transaction conditionally insert active variant metadata and set READY. Partial uploads are never
discoverable through the application.

### HLS authorization and delivery

A presigned master alone is invalid for a private bucket because nested relative playlists and
segments would be unsigned. Rewriting every manifest with many short-lived signatures couples
manifest parsing to credentials and makes cache/signature expiry behavior complex. Signed cookies
would be ideal at a CDN, but no CDN exists in this phase.

V1 therefore exposes an authenticated Reel delivery boundary for master, rendition manifests,
segments, and poster. Every request reuses ReelAccessPolicy: active Reel, active/profiled author,
both-direction block exclusion, and self/public/accepted-follower privacy. Object keys are never
returned. Nest streams object bodies and does not buffer video. This is correct and simple for the
educational/local scale but makes API bandwidth and connections a scaling limit.

Production evolution is private origin object storage -> CDN -> HLS client, with CDN signed cookies
or scoped tokens issued only after application authorization. The Media playback contract remains
storage-opaque so that change does not spread object-key knowledge through Reels or the UI.

### Web playback and publication

`/reels` supports file selection, direct-upload progress, processing state, finite two-second
polling, caption, and publication after READY. Upload completion is explicitly distinct from
processing completion. Safari/native HLS is preferred; pinned `hls.js` is used only where MSE is
supported, sends credentials to the API origin, handles fatal network/media errors, and is destroyed
on source change/unmount. The video is inline, muted for autoplay policy, looping, poster-backed,
and still exposes native controls. A single IntersectionObserver chooses the most visible item above
0.7, so other players pause. Only metadata for the active item is preloaded.

### Moderation and retention

REEL extends the relational moderation design with explicit nullable Reel foreign keys in reports
and cases, updated checks and insert trigger, evidence snapshot, enforcement, contracts, and event
validation. Moderator removal immediately blocks feed, direct reads, poster, playlists, and segment
delivery. Soft deletion behaves the same way. Derived/source objects are not deleted on the request
path because evidence, retries, and future retention policy need a shared Media decision.

V1 retains sources to permit reprocessing. Processing paths contain `v1`, so future encoder settings
can publish `v2` without overwriting the active set. A production policy should retain originals for
a bounded recovery window, keep referenced active derivatives, and remove unreferenced assets and
orphan attempts after a grace period.

## Failure model and observability

Terminal codes include unsupported container/video/audio codec or stream layout, excessive duration,
invalid dimensions/frame rate/media, file-size mismatch, and transcode failure. Missing source,
temporary storage failure, timeout, worker exit, and output upload failure retry. Raw ffprobe JSON,
presigned URLs, tokens, filenames, and unbounded FFmpeg output are not logged.

Structured worker logs carry event/correlation/media IDs, attempt, status, and timing-ready fields.
Useful future metrics are upload count, queue wait, success/failure by code, processing latency,
source/output bytes and ratio, lease reclaim count, and orphan cleanup count. No new metrics stack is
introduced merely for this phase.

## Consequences and extraction criteria

The design adds CPU and temp-disk pressure, API-proxied delivery, retained sources, and eventual
orphan cleanup debt. It gains authoritative decoding, adaptive playback, durable dispatch,
conditional publication, privacy-correct nested delivery, and testable retry semantics without a
new distributed consistency boundary.

Consider separate video infrastructure only when video jobs dominate CPU, require independent
autoscaling/SLOs/deploy cadence, hardware encoders, geographic processing, high volume, a dedicated
media team, or a sophisticated DRM/CDN pipeline. At that scale the likely path is browser presigned
multipart upload -> object storage event -> processing orchestrator -> transcoding fleet -> derived
origin -> CDN -> HLS client. Resumable uploads, perceptual-quality encoding, storyboards, and GPU
acceleration belong there. Domain separation alone is not evidence for microservices.
