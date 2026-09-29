CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONVERTED');
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "PaymentEventOutcome" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "PaymentEventStatus" AS ENUM ('PROCESSED', 'IGNORED');
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');
CREATE TYPE "RefundStatus" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "holds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "showId" UUID NOT NULL,
  "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "show_seats" ADD COLUMN "activeHoldId" UUID;
ALTER TABLE "show_seats" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

CREATE TABLE "hold_seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "holdId" UUID NOT NULL,
  "showSeatId" UUID NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  CONSTRAINT "hold_seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "holdId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "providerEventId" TEXT NOT NULL,
  "paymentIntentId" UUID NOT NULL,
  "outcome" "PaymentEventOutcome" NOT NULL,
  "status" "PaymentEventStatus" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bookings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "holdId" UUID NOT NULL,
  "paymentIntentId" UUID NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
  "totalMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bookingId" UUID NOT NULL,
  "showSeatId" UUID NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  CONSTRAINT "booking_seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bookingId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "RefundStatus" NOT NULL,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "show_seats_status_holdExpiresAt_idx" ON "show_seats"("status", "holdExpiresAt");
CREATE INDEX "show_seats_activeHoldId_idx" ON "show_seats"("activeHoldId");
CREATE INDEX "holds_userId_createdAt_idx" ON "holds"("userId", "createdAt");
CREATE INDEX "holds_status_expiresAt_idx" ON "holds"("status", "expiresAt");
CREATE UNIQUE INDEX "hold_seats_holdId_showSeatId_key" ON "hold_seats"("holdId", "showSeatId");
CREATE INDEX "hold_seats_showSeatId_idx" ON "hold_seats"("showSeatId");
CREATE INDEX "payment_intents_userId_createdAt_idx" ON "payment_intents"("userId", "createdAt");
CREATE INDEX "payment_intents_holdId_status_idx" ON "payment_intents"("holdId", "status");
CREATE UNIQUE INDEX "payment_events_providerEventId_key" ON "payment_events"("providerEventId");
CREATE INDEX "payment_events_paymentIntentId_createdAt_idx" ON "payment_events"("paymentIntentId", "createdAt");
CREATE UNIQUE INDEX "bookings_holdId_key" ON "bookings"("holdId");
CREATE UNIQUE INDEX "bookings_paymentIntentId_key" ON "bookings"("paymentIntentId");
CREATE INDEX "bookings_userId_createdAt_idx" ON "bookings"("userId", "createdAt");
CREATE UNIQUE INDEX "booking_seats_bookingId_showSeatId_key" ON "booking_seats"("bookingId", "showSeatId");
CREATE INDEX "booking_seats_showSeatId_idx" ON "booking_seats"("showSeatId");
CREATE UNIQUE INDEX "refunds_bookingId_key" ON "refunds"("bookingId");
CREATE UNIQUE INDEX "idempotency_keys_userId_scope_key_key" ON "idempotency_keys"("userId", "scope", "key");
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

ALTER TABLE "holds" ADD CONSTRAINT "holds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holds" ADD CONSTRAINT "holds_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_activeHoldId_fkey" FOREIGN KEY ("activeHoldId") REFERENCES "holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hold_seats" ADD CONSTRAINT "hold_seats_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hold_seats" ADD CONSTRAINT "hold_seats_showSeatId_fkey" FOREIGN KEY ("showSeatId") REFERENCES "show_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_seats" ADD CONSTRAINT "booking_seats_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_seats" ADD CONSTRAINT "booking_seats_showSeatId_fkey" FOREIGN KEY ("showSeatId") REFERENCES "show_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
