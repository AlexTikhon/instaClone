CREATE TABLE "follows" (
  "followerId" UUID NOT NULL,
  "followingId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follows_pkey" PRIMARY KEY ("followerId", "followingId"),
  CONSTRAINT "follows_not_self" CHECK ("followerId" <> "followingId")
);

CREATE TABLE "follow_requests" (
  "requesterId" UUID NOT NULL,
  "targetId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follow_requests_pkey" PRIMARY KEY ("requesterId", "targetId"),
  CONSTRAINT "follow_requests_not_self" CHECK ("requesterId" <> "targetId")
);

CREATE TABLE "blocks" (
  "blockerId" UUID NOT NULL,
  "blockedId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocks_pkey" PRIMARY KEY ("blockerId", "blockedId"),
  CONSTRAINT "blocks_not_self" CHECK ("blockerId" <> "blockedId")
);

CREATE INDEX "follows_followingId_createdAt_idx" ON "follows"("followingId", "createdAt");
CREATE INDEX "follow_requests_targetId_createdAt_idx" ON "follow_requests"("targetId", "createdAt");
CREATE INDEX "blocks_blockedId_idx" ON "blocks"("blockedId");

ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey"
  FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follows" ADD CONSTRAINT "follows_followingId_fkey"
  FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
