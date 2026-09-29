# SeatForge

SeatForge is a concurrency-safe ticket booking platform built to demonstrate production-style backend engineering and system design. The implementation follows the phased plan in [BACKEND_PROJECT_PLAN.md](./BACKEND_PROJECT_PLAN.md).

## Implemented phases

### Phase 1 - Foundation

The foundation includes:

- NestJS with TypeScript and the Express adapter;
- PostgreSQL with Prisma and a checked-in initial migration;
- JWT access and rotating refresh tokens;
- customer, organizer, and administrator roles;
- global authentication and role guards;
- DTO validation and a consistent error response;
- request IDs and structured, redacted HTTP logs;
- liveness and database-readiness endpoints;
- Swagger/OpenAPI documentation;
- Docker and Docker Compose;
- ESLint, Prettier, and GitHub Actions CI.

### Phase 2 - Catalog

The catalog includes:

- customer or organizer self-registration (administrator accounts cannot be self-created);
- organizer profiles with ownership boundaries;
- venues with nested sections and explicit physical seat layouts;
- draft or published events;
- scheduled shows with one ISO currency and section/category-specific prices stored in minor units;
- atomic generation of one inventory row per physical seat when a show is created;
- public, paginated event search by name, city, venue, UTC date, and category;
- public event details and live show-seat inventory endpoints;
- database uniqueness constraints and indexes for catalog searches and inventory access.

## Local development

Requirements: Node.js 24+, npm, and Docker.

```bash
copy .env.example .env
npm install
docker compose up -d postgres
npm run prisma:migrate:deploy
npm run start:dev
```

Open:

- API documentation: <http://localhost:3000/docs>
- Liveness: <http://localhost:3000/api/v1/health/live>
- Readiness: <http://localhost:3000/api/v1/health/ready>

Run all verification commands:

```bash
npm run format:check
npm run lint
npm run build
```

Start the complete production-style local stack:

```bash
docker compose up --build
```

The Docker API container applies pending Prisma migrations before starting.

## Authentication endpoints

All routes use the `/api/v1` prefix.

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me` (Bearer access token required)

Set `role` to `CUSTOMER` or `ORGANIZER` when registering; it defaults to `CUSTOMER`.
An organizer must create a profile before creating catalog resources.

## Catalog endpoints

Organizer routes require an access token with the `ORGANIZER` or `ADMIN` role:

- `POST /organizer/profile`
- `GET /organizer/profile`
- `POST /organizer/venues`
- `POST /organizer/events`
- `POST /organizer/shows`

Public routes:

- `GET /events?name=&city=&venue=&date=YYYY-MM-DD&category=&page=1&limit=20`
- `GET /events/:eventId`
- `GET /shows/:showId/seats`

Creating a show requires one price entry for every distinct section/category pair used by its
venue. For example, `Balcony / GOLD` and `Ground / GOLD` are separate prices. A show has one
three-letter ISO currency, while each price stores an integer minor-unit amount.

`ShowSeat` stores per-show availability for a physical seat and references the applicable
`ShowPrice`; it does not copy the monetary amount or currency. The final amount paid should be
snapshotted on the future booking item so historical purchases never change.

Show creation, section/category prices, and generated seat inventory are committed in one
PostgreSQL transaction.

Example show payload:

```json
{
  "eventId": "11111111-1111-4111-8111-111111111111",
  "venueId": "22222222-2222-4222-8222-222222222222",
  "startsAt": "2026-12-01T19:00:00.000Z",
  "endsAt": "2026-12-01T22:00:00.000Z",
  "currency": "INR",
  "prices": [
    {
      "sectionId": "33333333-3333-4333-8333-333333333333",
      "seatCategory": "SILVER",
      "priceMinor": 50000
    },
    {
      "sectionId": "44444444-4444-4444-8444-444444444444",
      "seatCategory": "SILVER",
      "priceMinor": 70000
    }
  ]
}
```

Never use the example JWT secrets outside local development.
