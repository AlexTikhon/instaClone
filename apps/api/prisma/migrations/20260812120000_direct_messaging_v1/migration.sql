CREATE TABLE "conversations" (
  "id" UUID NOT NULL,
  "lowerUserId" UUID NOT NULL,
  "higherUserId" UUID NOT NULL,
  "lastSequence" BIGINT NOT NULL DEFAULT 0,
  "lowerLastReadSequence" BIGINT NOT NULL DEFAULT 0,
  "higherLastReadSequence" BIGINT NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_canonical_pair" CHECK ("lowerUserId" < "higherUserId"),
  CONSTRAINT "conversations_sequences_nonnegative" CHECK (
    "lastSequence" >= 0
    AND "lowerLastReadSequence" >= 0
    AND "higherLastReadSequence" >= 0
    AND "lowerLastReadSequence" <= "lastSequence"
    AND "higherLastReadSequence" <= "lastSequence"
  )
);

CREATE TABLE "messages" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "senderId" UUID NOT NULL,
  "sequence" BIGINT NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "clientMessageId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messages_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "messages_body_not_blank" CHECK (length(btrim("body")) > 0)
);

CREATE UNIQUE INDEX "conversations_lowerUserId_higherUserId_key"
  ON "conversations"("lowerUserId", "higherUserId");
CREATE INDEX "conversations_lowerUserId_lastMessageAt_id_idx"
  ON "conversations"("lowerUserId", "lastMessageAt" DESC, "id" DESC);
CREATE INDEX "conversations_higherUserId_lastMessageAt_id_idx"
  ON "conversations"("higherUserId", "lastMessageAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "messages_conversationId_sequence_key"
  ON "messages"("conversationId", "sequence");
CREATE UNIQUE INDEX "messages_senderId_clientMessageId_key"
  ON "messages"("senderId", "clientMessageId");
CREATE INDEX "messages_conversationId_sequence_idx"
  ON "messages"("conversationId", "sequence" DESC);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lowerUserId_fkey"
  FOREIGN KEY ("lowerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_higherUserId_fkey"
  FOREIGN KEY ("higherUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_message_sender_membership()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "conversations" c
    WHERE c."id" = NEW."conversationId"
      AND NEW."senderId" IN (c."lowerUserId", c."higherUserId")
  ) THEN
    RAISE EXCEPTION 'message sender must participate in conversation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_sender_membership"
BEFORE INSERT OR UPDATE OF "conversationId", "senderId" ON "messages"
FOR EACH ROW EXECUTE FUNCTION enforce_message_sender_membership();
