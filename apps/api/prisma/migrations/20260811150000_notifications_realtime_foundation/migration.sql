CREATE TYPE "NotificationType" AS ENUM ('LIKE', 'COMMENT', 'FOLLOW', 'FOLLOW_REQUEST');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "sourceEventId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "actorId" UUID,
  "type" "NotificationType" NOT NULL,
  "postId" UUID,
  "commentId" UUID,
  "actorUsername" VARCHAR(30) NOT NULL,
  "actorDisplayName" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMPTZ(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_not_self" CHECK ("actorId" IS NULL OR "actorId" <> "recipientId")
);

CREATE UNIQUE INDEX "notifications_sourceEventId_key" ON "notifications"("sourceEventId");
CREATE INDEX "notifications_recipientId_createdAt_id_idx"
  ON "notifications"("recipientId", "createdAt", "id");
CREATE INDEX "notifications_recipient_unread_idx"
  ON "notifications"("recipientId") WHERE "readAt" IS NULL;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
