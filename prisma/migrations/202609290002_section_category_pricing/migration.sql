ALTER TABLE "shows"
ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'INR';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "show_prices"
    GROUP BY "showId"
    HAVING COUNT(DISTINCT UPPER("currency")) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate shows that use multiple currencies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "show_seats" AS show_seat
    JOIN "seats" AS seat ON seat."id" = show_seat."seatId"
    LEFT JOIN "show_prices" AS price
      ON price."showId" = show_seat."showId"
     AND UPPER(price."seatCategory") = UPPER(seat."category")
    WHERE price."id" IS NULL
       OR show_seat."priceMinor" <> price."priceMinor"
       OR UPPER(show_seat."currency") <> UPPER(price."currency")
  ) THEN
    RAISE EXCEPTION 'Cannot migrate inconsistent show-seat prices';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "show_prices" AS price
    JOIN "shows" AS source_show ON source_show."id" = price."showId"
    WHERE NOT EXISTS (
      SELECT 1
      FROM "venue_sections" AS section
      JOIN "seats" AS seat ON seat."sectionId" = section."id"
      WHERE section."venueId" = source_show."venueId"
        AND UPPER(seat."category") = UPPER(price."seatCategory")
    )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate prices that do not match venue seats';
  END IF;
END $$;

UPDATE "shows" AS target_show
SET "currency" = price."currency"
FROM (
  SELECT "showId", MIN(UPPER("currency")) AS "currency"
  FROM "show_prices"
  GROUP BY "showId"
) AS price
WHERE target_show."id" = price."showId";

CREATE TABLE "show_prices_new" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "showId" UUID NOT NULL,
  "sectionId" UUID NOT NULL,
  "seatCategory" TEXT NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  CONSTRAINT "show_prices_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "show_prices_new" ("showId", "sectionId", "seatCategory", "priceMinor")
SELECT DISTINCT
  price."showId",
  section."id",
  UPPER(price."seatCategory"),
  price."priceMinor"
FROM "show_prices" AS price
JOIN "shows" AS source_show ON source_show."id" = price."showId"
JOIN "venue_sections" AS section ON section."venueId" = source_show."venueId"
JOIN "seats" AS seat
  ON seat."sectionId" = section."id"
 AND UPPER(seat."category") = UPPER(price."seatCategory");

DROP TABLE "show_prices";
ALTER TABLE "show_prices_new" RENAME TO "show_prices";
ALTER TABLE "show_prices" RENAME CONSTRAINT "show_prices_new_pkey" TO "show_prices_pkey";

ALTER TABLE "show_seats"
DROP COLUMN "priceMinor",
DROP COLUMN "currency";

CREATE UNIQUE INDEX "show_prices_showId_sectionId_seatCategory_key"
ON "show_prices"("showId", "sectionId", "seatCategory");
CREATE INDEX "show_prices_sectionId_idx" ON "show_prices"("sectionId");

ALTER TABLE "show_prices"
ADD CONSTRAINT "show_prices_showId_fkey"
FOREIGN KEY ("showId") REFERENCES "shows"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "show_prices"
ADD CONSTRAINT "show_prices_sectionId_fkey"
FOREIGN KEY ("sectionId") REFERENCES "venue_sections"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "show_seats" ADD COLUMN "showPriceId" UUID;

UPDATE "show_seats" AS show_seat
SET "showPriceId" = price."id"
FROM "seats" AS seat
JOIN "show_prices" AS price
  ON price."sectionId" = seat."sectionId"
 AND price."seatCategory" = UPPER(seat."category")
WHERE show_seat."seatId" = seat."id"
  AND price."showId" = show_seat."showId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "show_seats" WHERE "showPriceId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign every show seat to a section/category price';
  END IF;
END $$;

ALTER TABLE "show_seats" ALTER COLUMN "showPriceId" SET NOT NULL;
CREATE INDEX "show_seats_showPriceId_idx" ON "show_seats"("showPriceId");

ALTER TABLE "show_seats"
ADD CONSTRAINT "show_seats_showPriceId_fkey"
FOREIGN KEY ("showPriceId") REFERENCES "show_prices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shows"
ADD CONSTRAINT "shows_valid_time_range_check" CHECK ("endsAt" > "startsAt"),
ADD CONSTRAINT "shows_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "show_prices"
ADD CONSTRAINT "show_prices_nonnegative_price_check" CHECK ("priceMinor" >= 0),
ADD CONSTRAINT "show_prices_category_format_check"
CHECK (LENGTH(BTRIM("seatCategory")) > 0 AND "seatCategory" = UPPER(BTRIM("seatCategory")));
