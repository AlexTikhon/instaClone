-- Phase 6 Stories are independent content records that reuse immutable MediaAssets.
CREATE TABLE "stories" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stories_expiration_after_creation" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "story_views" (
    "storyId" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("storyId", "viewerId")
);

CREATE INDEX "stories_authorId_expiresAt_createdAt_id_idx"
ON "stories"("authorId", "expiresAt", "createdAt", "id");

CREATE INDEX "stories_expiresAt_authorId_idx" ON "stories"("expiresAt", "authorId");

CREATE INDEX "story_views_storyId_viewedAt_viewerId_idx"
ON "story_views"("storyId", "viewedAt", "viewerId");

ALTER TABLE "stories"
ADD CONSTRAINT "stories_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stories"
ADD CONSTRAINT "stories_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_views"
ADD CONSTRAINT "story_views_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_views"
ADD CONSTRAINT "story_views_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
