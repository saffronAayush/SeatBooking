CREATE TYPE "TicketStatus" AS ENUM ('ACTIVE', 'VOID');

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "lockedUntil" TIMESTAMP(3),
  "lockToken" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "outbox_events_eventKey_key" ON "outbox_events"("eventKey");
CREATE INDEX "outbox_events_publishedAt_availableAt_lockedUntil_idx" ON "outbox_events"("publishedAt", "availableAt", "lockedUntil");

CREATE TABLE "consumed_events" (
  "consumer" TEXT NOT NULL,
  "eventId" UUID NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("consumer", "eventId")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notifications_eventId_key" ON "notifications"("eventId");
CREATE INDEX "notifications_userId_createdAt_id_idx" ON "notifications"("userId", "createdAt", "id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bookingId" UUID NOT NULL,
  "code" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" "TicketStatus" NOT NULL DEFAULT 'ACTIVE',
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tickets_bookingId_key" ON "tickets"("bookingId");
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payment_intents_status_createdAt_idx" ON "payment_intents"("status", "createdAt");
