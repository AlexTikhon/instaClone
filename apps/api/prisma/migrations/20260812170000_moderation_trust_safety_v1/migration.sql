CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');
CREATE TYPE "ModerationTargetType" AS ENUM ('USER', 'POST', 'COMMENT', 'STORY');
CREATE TYPE "ReportReason" AS ENUM (
  'SPAM', 'HARASSMENT', 'HATE_OR_ABUSE', 'SEXUAL_CONTENT',
  'VIOLENCE', 'IMPERSONATION', 'SCAM', 'OTHER'
);
CREATE TYPE "ReportStatus" AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLOSED');
CREATE TYPE "ModerationDecisionAction" AS ENUM ('NO_ACTION', 'REMOVE_CONTENT', 'SUSPEND_ACCOUNT');
CREATE TYPE "ModerationAuditAction" AS ENUM (
  'START_REVIEW', 'NO_ACTION', 'REMOVE_CONTENT', 'SUSPEND_ACCOUNT'
);

ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';
ALTER TABLE "posts" ADD COLUMN "moderationRemovedAt" TIMESTAMPTZ(3);
ALTER TABLE "comments" ADD COLUMN "moderationRemovedAt" TIMESTAMPTZ(3);
ALTER TABLE "stories" ADD COLUMN "moderationRemovedAt" TIMESTAMPTZ(3);

CREATE TABLE "moderation_cases" (
  "id" UUID NOT NULL,
  "targetType" "ModerationTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "userTargetId" UUID,
  "postTargetId" UUID,
  "commentTargetId" UUID,
  "storyTargetId" UUID,
  "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "reviewerId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "closedAt" TIMESTAMPTZ(3),
  CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_cases_target_reference" CHECK (
    num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId") <= 1
    AND (
      num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId") = 0
      OR ("targetType" = 'USER' AND "userTargetId" = "targetId")
      OR ("targetType" = 'POST' AND "postTargetId" = "targetId")
      OR ("targetType" = 'COMMENT' AND "commentTargetId" = "targetId")
      OR ("targetType" = 'STORY' AND "storyTargetId" = "targetId")
    )
  ),
  CONSTRAINT "moderation_cases_closed_state" CHECK (
    ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
    OR ("status" <> 'CLOSED' AND "closedAt" IS NULL)
  )
);

CREATE TABLE "reports" (
  "id" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "reporterId" UUID NOT NULL,
  "targetType" "ModerationTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "userTargetId" UUID,
  "postTargetId" UUID,
  "commentTargetId" UUID,
  "storyTargetId" UUID,
  "reason" "ReportReason" NOT NULL,
  "details" VARCHAR(1000),
  "status" "ReportStatus" NOT NULL DEFAULT 'ACTIVE',
  "snapshotText" VARCHAR(2200),
  "snapshotUsername" VARCHAR(30) NOT NULL,
  "snapshotOwnerId" UUID NOT NULL,
  "snapshotMediaAssetIds" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(3),
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reports_initial_target_reference" CHECK (
    num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId") <= 1
    AND (
      num_nonnulls("userTargetId", "postTargetId", "commentTargetId", "storyTargetId") = 0
      OR ("targetType" = 'USER' AND "userTargetId" = "targetId")
      OR ("targetType" = 'POST' AND "postTargetId" = "targetId")
      OR ("targetType" = 'COMMENT' AND "commentTargetId" = "targetId")
      OR ("targetType" = 'STORY' AND "storyTargetId" = "targetId")
    )
  ),
  CONSTRAINT "reports_closed_state" CHECK (
    ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
    OR ("status" = 'ACTIVE' AND "closedAt" IS NULL)
  )
);

CREATE TABLE "moderation_decisions" (
  "id" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" "ModerationDecisionAction" NOT NULL,
  "internalNote" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moderation_audit_logs" (
  "id" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" "ModerationAuditAction" NOT NULL,
  "targetType" "ModerationTargetType" NOT NULL,
  "targetId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "moderation_cases_active_target_key"
  ON "moderation_cases" ("targetType", "targetId")
  WHERE "status" IN ('OPEN', 'IN_REVIEW');
CREATE INDEX "moderation_cases_status_createdAt_id_idx"
  ON "moderation_cases" ("status", "createdAt" DESC, "id" DESC);
CREATE INDEX "moderation_cases_reviewerId_status_createdAt_idx"
  ON "moderation_cases" ("reviewerId", "status", "createdAt" DESC);
CREATE INDEX "reports_caseId_createdAt_id_idx"
  ON "reports" ("caseId", "createdAt", "id");
CREATE INDEX "reports_reporterId_createdAt_idx"
  ON "reports" ("reporterId", "createdAt" DESC);
CREATE INDEX "reports_targetType_targetId_createdAt_idx"
  ON "reports" ("targetType", "targetId", "createdAt" DESC);
CREATE UNIQUE INDEX "reports_active_duplicate_key"
  ON "reports" ("reporterId", "targetType", "targetId", "reason")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "moderation_decisions_caseId_key" ON "moderation_decisions" ("caseId");
CREATE INDEX "moderation_decisions_actorUserId_createdAt_idx"
  ON "moderation_decisions" ("actorUserId", "createdAt" DESC);
CREATE INDEX "moderation_audit_logs_caseId_createdAt_id_idx"
  ON "moderation_audit_logs" ("caseId", "createdAt", "id");
CREATE INDEX "moderation_audit_logs_actorUserId_createdAt_idx"
  ON "moderation_audit_logs" ("actorUserId", "createdAt" DESC);

ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_userTargetId_fkey"
  FOREIGN KEY ("userTargetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_postTargetId_fkey"
  FOREIGN KEY ("postTargetId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_commentTargetId_fkey"
  FOREIGN KEY ("commentTargetId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_storyTargetId_fkey"
  FOREIGN KEY ("storyTargetId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_userTargetId_fkey"
  FOREIGN KEY ("userTargetId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_postTargetId_fkey"
  FOREIGN KEY ("postTargetId") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_commentTargetId_fkey"
  FOREIGN KEY ("commentTargetId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_storyTargetId_fkey"
  FOREIGN KEY ("storyTargetId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_audit_logs" ADD CONSTRAINT "moderation_audit_logs_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_audit_logs" ADD CONSTRAINT "moderation_audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_moderation_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_moderation_audit_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'moderation audit history is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "moderation_audit_logs_immutable_update"
BEFORE UPDATE ON "moderation_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
CREATE TRIGGER "moderation_audit_logs_immutable_delete"
BEFORE DELETE ON "moderation_audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();

CREATE FUNCTION validate_moderation_target_insert() RETURNS trigger AS $$
BEGIN
  IF num_nonnulls(NEW."userTargetId", NEW."postTargetId", NEW."commentTargetId", NEW."storyTargetId") <> 1 THEN
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

CREATE FUNCTION reject_moderation_target_identity_change() RETURNS trigger AS $$
BEGIN
  IF NEW."targetType" <> OLD."targetType" OR NEW."targetId" <> OLD."targetId" THEN
    RAISE EXCEPTION 'moderation target identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "moderation_cases_target_identity_immutable"
BEFORE UPDATE ON "moderation_cases"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_target_identity_change();
CREATE TRIGGER "reports_target_identity_immutable"
BEFORE UPDATE ON "reports"
FOR EACH ROW EXECUTE FUNCTION reject_moderation_target_identity_change();
