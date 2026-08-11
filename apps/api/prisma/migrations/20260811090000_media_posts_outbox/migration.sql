DROP INDEX "follow_requests_targetId_createdAt_idx";
CREATE INDEX "follow_requests_targetId_createdAt_requesterId_idx"
  ON "follow_requests"("targetId", "createdAt", "requesterId");

CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "MediaAssetStatus" AS ENUM (
  'PENDING_UPLOAD',
  'UPLOADED',
  'PROCESSING',
  'READY',
  'FAILED'
);

CREATE TABLE "media_assets" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "kind" "MediaKind" NOT NULL,
  "objectKey" VARCHAR(512) NOT NULL,
  "thumbnailObjectKey" VARCHAR(512),
  "declaredMimeType" VARCHAR(128) NOT NULL,
  "declaredSizeBytes" INTEGER NOT NULL,
  "verifiedSizeBytes" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "durationMs" INTEGER,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_assets_declared_size_positive" CHECK ("declaredSizeBytes" > 0),
  CONSTRAINT "media_assets_verified_size_positive" CHECK ("verifiedSizeBytes" IS NULL OR "verifiedSizeBytes" > 0),
  CONSTRAINT "media_assets_dimensions_positive" CHECK (
    ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
  )
);

CREATE TABLE "posts" (
  "id" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "caption" VARCHAR(2200) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "post_media" (
  "postId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "post_media_pkey" PRIMARY KEY ("postId", "mediaAssetId"),
  CONSTRAINT "post_media_position_nonnegative" CHECK ("position" >= 0)
);

CREATE TABLE "outbox_events" (
  "eventId" UUID NOT NULL,
  "eventName" VARCHAR(128) NOT NULL,
  "eventVersion" INTEGER NOT NULL,
  "aggregateType" VARCHAR(64) NOT NULL,
  "aggregateId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correlationId" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "publishedAt" TIMESTAMPTZ(3),
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" VARCHAR(128),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(512),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "outbox_events_version_positive" CHECK ("eventVersion" > 0),
  CONSTRAINT "outbox_events_attempt_count_nonnegative" CHECK ("attemptCount" >= 0)
);

CREATE TABLE "consumer_event_receipts" (
  "eventId" UUID NOT NULL,
  "consumerName" VARCHAR(128) NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consumer_event_receipts_pkey" PRIMARY KEY ("eventId", "consumerName")
);

CREATE UNIQUE INDEX "media_assets_objectKey_key" ON "media_assets"("objectKey");
CREATE UNIQUE INDEX "media_assets_thumbnailObjectKey_key" ON "media_assets"("thumbnailObjectKey");
CREATE INDEX "media_assets_ownerId_createdAt_idx" ON "media_assets"("ownerId", "createdAt");
CREATE INDEX "media_assets_status_updatedAt_idx" ON "media_assets"("status", "updatedAt");
CREATE INDEX "posts_authorId_createdAt_id_idx" ON "posts"("authorId", "createdAt", "id");
CREATE UNIQUE INDEX "post_media_mediaAssetId_key" ON "post_media"("mediaAssetId");
CREATE UNIQUE INDEX "post_media_postId_position_key" ON "post_media"("postId", "position");
CREATE INDEX "outbox_events_publishedAt_lockedAt_occurredAt_idx"
  ON "outbox_events"("publishedAt", "lockedAt", "occurredAt");

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
