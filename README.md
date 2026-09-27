# SeatForge

SeatForge is a concurrency-safe ticket booking platform built to demonstrate production-style backend engineering and system design. The implementation follows the phased plan in [BACKEND_PROJECT_PLAN.md](./BACKEND_PROJECT_PLAN.md).

## Phase 1 foundation

The current foundation includes:

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

Never use the example JWT secrets outside local development.
