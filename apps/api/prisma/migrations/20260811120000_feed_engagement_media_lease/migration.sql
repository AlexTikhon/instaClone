ALTER TABLE "media_assets"
  ADD COLUMN "processingStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "processingLeaseUntil" TIMESTAMPTZ(3),
  ADD COLUMN "processingWorkerId" VARCHAR(128);

CREATE INDEX "media_assets_status_processingLeaseUntil_idx"
  ON "media_assets"("status", "processingLeaseUntil");

CREATE TABLE "post_likes" (
  "userId" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_likes_pkey" PRIMARY KEY ("userId", "postId")
);

CREATE TABLE "comments" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "body" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),
  CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comments_body_not_blank" CHECK (length(btrim("body")) > 0)
);

CREATE TABLE "saved_posts" (
  "userId" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_posts_pkey" PRIMARY KEY ("userId", "postId")
);

CREATE INDEX "posts_deletedAt_createdAt_id_idx" ON "posts"("deletedAt", "createdAt", "id");
CREATE INDEX "post_likes_postId_idx" ON "post_likes"("postId");
CREATE INDEX "comments_postId_deletedAt_createdAt_id_idx"
  ON "comments"("postId", "deletedAt", "createdAt", "id");
CREATE INDEX "comments_authorId_createdAt_idx" ON "comments"("authorId", "createdAt");
CREATE INDEX "saved_posts_postId_idx" ON "saved_posts"("postId");

ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
