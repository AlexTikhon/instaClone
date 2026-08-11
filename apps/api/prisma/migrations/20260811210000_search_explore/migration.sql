CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Retain unlike time so an Explore cursor can reproduce like membership at its fixed snapshot.
ALTER TABLE "post_likes" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

CREATE INDEX "profiles_username_lower_pattern_idx"
  ON "profiles" (lower("username") text_pattern_ops);
CREATE INDEX "profiles_displayName_lower_pattern_idx"
  ON "profiles" (lower("displayName") text_pattern_ops);
CREATE INDEX "profiles_username_lower_trgm_idx"
  ON "profiles" USING GIN (lower("username") gin_trgm_ops);
CREATE INDEX "profiles_displayName_lower_trgm_idx"
  ON "profiles" USING GIN (lower("displayName") gin_trgm_ops);
