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
- scheduled shows with category-specific prices stored in minor currency units;
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

Creating a show requires one price entry for every seat category in its venue. Show creation,
prices, and generated seat inventory are committed in one PostgreSQL transaction.

Never use the example JWT secrets outside local development.
