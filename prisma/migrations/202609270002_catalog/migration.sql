CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
CREATE TYPE "ShowStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE "ShowSeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED');

CREATE TABLE "organizers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "venues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizerId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "venue_sections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venueId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "venue_sections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sectionId" UUID NOT NULL,
  "rowLabel" TEXT NOT NULL,
  "seatNumber" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizerId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "venueId" UUID NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "ShowStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "show_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "showId" UUID NOT NULL,
  "seatCategory" TEXT NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  CONSTRAINT "show_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "show_seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "showId" UUID NOT NULL,
  "seatId" UUID NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "status" "ShowSeatStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "show_seats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizers_userId_key" ON "organizers"("userId");
CREATE UNIQUE INDEX "venues_organizerId_name_city_key" ON "venues"("organizerId", "name", "city");
CREATE INDEX "venues_city_name_idx" ON "venues"("city", "name");
CREATE UNIQUE INDEX "venue_sections_venueId_name_key" ON "venue_sections"("venueId", "name");
CREATE INDEX "venue_sections_venueId_sortOrder_idx" ON "venue_sections"("venueId", "sortOrder");
CREATE UNIQUE INDEX "seats_sectionId_rowLabel_seatNumber_key" ON "seats"("sectionId", "rowLabel", "seatNumber");
CREATE INDEX "seats_sectionId_category_idx" ON "seats"("sectionId", "category");
CREATE INDEX "events_status_category_title_idx" ON "events"("status", "category", "title");
CREATE INDEX "events_organizerId_createdAt_idx" ON "events"("organizerId", "createdAt");
CREATE UNIQUE INDEX "shows_eventId_venueId_startsAt_key" ON "shows"("eventId", "venueId", "startsAt");
CREATE INDEX "shows_startsAt_status_idx" ON "shows"("startsAt", "status");
CREATE INDEX "shows_venueId_startsAt_idx" ON "shows"("venueId", "startsAt");
CREATE UNIQUE INDEX "show_prices_showId_seatCategory_key" ON "show_prices"("showId", "seatCategory");
CREATE UNIQUE INDEX "show_seats_showId_seatId_key" ON "show_seats"("showId", "seatId");
CREATE INDEX "show_seats_showId_status_idx" ON "show_seats"("showId", "status");

ALTER TABLE "organizers" ADD CONSTRAINT "organizers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venues" ADD CONSTRAINT "venues_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venue_sections" ADD CONSTRAINT "venue_sections_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seats" ADD CONSTRAINT "seats_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "venue_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shows" ADD CONSTRAINT "shows_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shows" ADD CONSTRAINT "shows_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "show_prices" ADD CONSTRAINT "show_prices_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
