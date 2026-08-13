ALTER TYPE "ModerationTargetType" ADD VALUE 'REEL';

ALTER TABLE "media_assets"
  ADD COLUMN "videoCodec" VARCHAR(32),
  ADD COLUMN "audioCodec" VARCHAR(32),
  ADD COLUMN "frameRate" DOUBLE PRECISION,
  ADD COLUMN "rotationDegrees" INTEGER,
  ADD COLUMN "processingVersion" INTEGER;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_duration_nonnegative"
    CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  ADD CONSTRAINT "media_assets_frame_rate_positive"
    CHECK ("frameRate" IS NULL OR ("frameRate" > 0 AND "frameRate" <= 240)),
  ADD CONSTRAINT "media_assets_rotation_supported"
    CHECK ("rotationDegrees" IS NULL OR "rotationDegrees" IN (0, 90, 180, 270)),
  ADD CONSTRAINT "media_assets_processing_version_positive"
    CHECK ("processingVersion" IS NULL OR "processingVersion" > 0);

CREATE TYPE "MediaVariantType" AS ENUM ('HLS_MASTER', 'HLS_RENDITION', 'POSTER');

CREATE TABLE "media_variants" (
  "id" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "type" "MediaVariantType" NOT NULL,
  "label" VARCHAR(32) NOT NULL,
  "processingVersion" INTEGER NOT NULL,
  "objectKey" VARCHAR(512) NOT NULL,
  "mimeType" VARCHAR(128) NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "bitrateKbps" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_variants_processing_version_positive" CHECK ("processingVersion" > 0),
  CONSTRAINT "media_variants_dimensions_positive" CHECK (
    ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
  ),
  CONSTRAINT "media_variants_bitrate_positive" CHECK ("bitrateKbps" IS NULL OR "bitrateKbps" > 0)
);

CREATE UNIQUE INDEX "media_variants_objectKey_key" ON "media_variants"("objectKey");
CREATE UNIQUE INDEX "media_variants_mediaAssetId_processingVersion_type_label_key"
  ON "media_variants"("mediaAssetId", "processingVersion", "type", "label");
CREATE INDEX "media_variants_mediaAssetId_processingVersion_idx"
  ON "media_variants"("mediaAssetId", "processingVersion");
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reels" (
  "id" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "caption" VARCHAR(2200) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  "moderationRemovedAt" TIMESTAMPTZ(3),
  CONSTRAINT "reels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reels_mediaAssetId_key" ON "reels"("mediaAssetId");
CREATE INDEX "reels_createdAt_id_idx" ON "reels"("createdAt" DESC, "id" DESC);
CREATE INDEX "reels_authorId_createdAt_id_idx" ON "reels"("authorId", "createdAt" DESC, "id" DESC);
ALTER TABLE "reels" ADD CONSTRAINT "reels_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reels" ADD CONSTRAINT "reels_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "moderation_cases" ADD COLUMN "reelTargetId" UUID;
ALTER TABLE "reports" ADD COLUMN "reelTargetId" UUID;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_reelTargetId_fkey"
  FOREIGN KEY ("reelTargetId") REFERENCES "reels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reelTargetId_fkey"
  FOREIGN KEY ("reelTargetId") REFERENCES "reels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TRIGGER "moderation_cases_validate_target_insert" ON "moderation_cases";
DROP TRIGGER "reports_validate_target_insert" ON "reports";
DROP FUNCTION validate_moderation_target_insert();
ALTER TABLE "moderation_cases" DROP CONSTRAINT "moderation_cases_target_reference";
ALTER TABLE "reports" DROP CONSTRAINT "reports_initial_target_reference";

ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_target_reference" CHECK (
  num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId", "reelTargetId") <= 1
  AND (
    num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId", "reelTargetId") = 0
    OR ("targetType" = 'USER' AND "userTargetId" = "targetId")
    OR ("targetType" = 'POST' AND "postTargetId" = "targetId")
    OR ("targetType" = 'COMMENT' AND "commentTargetId" = "targetId")
    OR ("targetType" = 'STORY' AND "storyTargetId" = "targetId")
    OR ("targetType" = 'REEL' AND "reelTargetId" = "targetId")
  )
);
ALTER TABLE "reports" ADD CONSTRAINT "reports_initial_target_reference" CHECK (
  num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId", "reelTargetId") <= 1
  AND (
    num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId", "reelTargetId") = 0
    OR ("targetType" = 'USER' AND "userTargetId" = "targetId")
    OR ("targetType" = 'POST' AND "postTargetId" = "targetId")
    OR ("targetType" = 'COMMENT' AND "commentTargetId" = "targetId")
    OR ("targetType" = 'STORY' AND "storyTargetId" = "targetId")
    OR ("targetType" = 'REEL' AND "reelTargetId" = "targetId")
  )
);

CREATE FUNCTION validate_moderation_target_insert() RETURNS trigger AS $$
BEGIN
  IF num_nonnulls(
    NEW."userTargetId", NEW."postTargetId", NEW."commentTargetId",
    NEW."storyTargetId", NEW."reelTargetId"
  ) <> 1 THEN
    RAISE EXCEPTION 'moderation target must have exactly one relational reference' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "moderation_cases_validate_target_insert"
BEFORE INSERT ON "moderation_cases"
FOR EACH ROW EXECUTE FUNCTION validate_moderation_target_insert();
CREATE TRIGGER "reports_validate_target_insert"
BEFORE INSERT ON "reports"
FOR EACH ROW EXECUTE FUNCTION validate_moderation_target_insert();
