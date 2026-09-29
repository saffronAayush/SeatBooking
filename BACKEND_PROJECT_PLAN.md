# SeatForge - Distributed Ticket Booking and Reservation Platform

## 1. Project overview

SeatForge is a backend-heavy ticket booking platform inspired by BookMyShow and IRCTC. Organizers create venues and events, publish shows with a fixed seat inventory, and users search for shows, temporarily hold seats, simulate a payment, and receive a confirmed booking.

The main engineering challenge is not the user interface. It is guaranteeing that the same seat is never sold twice when many users try to book it simultaneously, while keeping the system responsive and recoverable when payments, workers, or services fail.

This project should demonstrate:

- concurrency control and database transactions;
- idempotent APIs and payment processing;
- caching and distributed rate limiting;
- asynchronous processing with a message broker;
- horizontal scaling behind a load balancer;
- fault handling, retries, and dead-letter queues;
- logs, metrics, traces, and load testing;
- documented system-design decisions and trade-offs.

## 2. Recommended scope

Build a polished backend with a small functional frontend or Swagger/OpenAPI interface. The backend, architecture, tests, and measurements are the primary deliverables.

### Versioned delivery plan

The project is intentionally divided into two releases. **V1 proves correctness and core backend engineering. V2 proves behavior under flash-sale traffic and introduces advanced scale controls.** Finish and test V1 before adding V2 features.

#### V1 - Essential, resume-ready system

- Modular NestJS API with PostgreSQL as the source of truth.
- Authentication, RBAC, venue/event/show management, seat holds, simulated payments, and bookings.
- Transactional concurrency control that prevents double booking.
- Idempotency for retryable writes and duplicate payment callbacks.
- Redis caching and distributed rate limiting.
- RabbitMQ workers for notifications, ticket generation, expiry, and recovery jobs.
- Transactional outbox, retries, dead-letter handling, and reconciliation.
- Correct indexes, pagination, query timeouts, and database connection pooling.
- Nginx with at least two stateless API replicas and independently scalable workers.
- Health checks, graceful shutdown, structured logs, core metrics, traces, and k6 tests.
- Docker Compose, CI, API documentation, diagrams, and reproducible performance results.

#### V2 - Flash-sale and advanced scaling

- Virtual waiting room with signed queue/admission tokens.
- Admission control that releases users according to measured system capacity.
- Backpressure and load shedding when the database, API, or queues approach safe limits.
- Real-time seat updates using WebSockets or Server-Sent Events instead of aggressive polling.
- Read replicas for catalog and reporting traffic.
- Table partitioning for bookings, payment events, outbox events, and audit logs.
- Worker autoscaling based on queue depth and processing latency.
- Circuit breakers around external dependencies.
- WAF and stronger bot/abuse protection for flash sales.
- Backup/restore drills, deeper failure injection, and disaster-recovery documentation.
- Optional sharding proof of concept only after measurements justify it.

Features marked V2 should still appear in the architecture discussion, but they do not block a strong V1 release.

### User roles

- **Customer:** browses events, holds seats, pays, and views bookings.
- **Organizer:** manages venues, events, shows, pricing, and inventory.
- **Administrator:** manages users, organizers, refunds, and audit records.

### Core user journey

1. An organizer creates a venue and its seat layout.
2. The organizer creates an event and schedules a show at that venue.
3. The system stores section/category prices and generates the seat inventory for the show.
4. A customer searches for the event and views available seats.
5. The customer places selected seats on hold for five minutes.
6. The customer starts a simulated payment.
7. A successful payment converts the hold into a confirmed booking.
8. Failed or expired payments release the seats.
9. A worker sends a booking notification and generates a ticket.

## 3. Functional requirements

### Authentication and authorization

- Email/password registration and login.
- JWT access and refresh tokens with rotation.
- Role-based access control for customers, organizers, and administrators.
- Optional Google OAuth after the core system works.

### Event catalog

- Create venues, screens or sections, rows, and seats.
- Create events and multiple scheduled shows.
- Configure show-specific pricing for every section/category pair used by the venue.
- Search events by name, city, venue, date, and category.

### Seat inventory and reservations

- Display the latest seat availability for a show.
- Hold multiple seats atomically for a configurable period.
- Prevent double holds and double bookings under concurrency.
- Allow a user to release a hold.
- Automatically expire abandoned holds.
- Publish inventory changes so clients can refresh availability.

### Booking and payment

- Create a booking from a valid hold.
- Simulate successful, failed, delayed, and duplicate payment callbacks.
- Make booking and payment endpoints idempotent.
- Confirm seats only once even if a callback is delivered repeatedly.
- Support cancellation and a basic simulated refund workflow.

### Notifications and administration

- Process email or in-app notifications asynchronously.
- Provide organizer sales and occupancy summaries.
- Maintain an audit trail for sensitive administrative operations.

## 4. Non-functional requirements

- No seat may be confirmed for more than one booking.
- All public write endpoints must support validation and safe error responses.
- API servers must be stateless so multiple replicas can run concurrently.
- A retry or duplicate request must not create a duplicate booking or charge.
- Temporary dependency failures must not corrupt booking state.
- Slow notification work must not delay the booking response.
- Important operations must be observable through logs, metrics, and traces.
- The system should degrade safely when Redis or the message broker is unavailable.

Suggested measurable targets for the completed project:

- 1,000 concurrent users in a documented load test.
- At least 200 booking/hold requests per second on the test machine.
- No double bookings during a high-contention test for the same seats.
- p95 read latency below 250 ms and p95 write latency below 500 ms under the documented test profile.
- Successful recovery of queued events after a worker restart.

These are learning targets, not promises. Record the machine, dataset, test script, and actual results honestly.

## 5. Recommended technology stack

- **Backend:** NestJS with TypeScript and Express adapter.
- **Primary database:** PostgreSQL.
- **Cache and coordination:** Redis.
- **Message broker:** RabbitMQ.
- **ORM/query layer:** Prisma or TypeORM; use raw SQL where concurrency control requires it.
- **Load balancer/reverse proxy:** Nginx.
- **API documentation:** OpenAPI/Swagger.
- **Containers:** Docker and Docker Compose.
- **Testing:** Jest, Supertest, and k6.
- **Observability:** OpenTelemetry, Prometheus, Grafana, and structured logs with Pino.
- **CI/CD:** GitHub Actions.
- **Optional frontend:** Next.js with a minimal customer and organizer interface.

RabbitMQ is recommended over Kafka for the first version because the main requirement is reliable job and event delivery. Kafka can be explored later if event replay and high-throughput streams become learning goals.

## 6. Architecture strategy

Start as a **modular monolith plus independent background workers**. Do not create many networked microservices on day one. Clear module boundaries provide most of the architectural learning without unnecessary deployment and debugging complexity.

```text
Clients
   |
   v
Virtual Waiting Room / Admission Control (V2, flash sales)
   |
   v
Nginx / Load Balancer
   |
   +-------------------+-------------------+
   |                   |                   |
API Instance 1    API Instance 2     API Instance N
   |                   |                   |
   +-------------------+-------------------+
                       |
        +--------------+---------------+
        |              |               |
   PostgreSQL        Redis          RabbitMQ
        |                              |
        |                       Background Workers
        |                        |             |
        +------------------- Notifications   Expiry/Recovery

Observability: OpenTelemetry -> Prometheus/Grafana + structured logs
```

### Backend modules

- **Identity:** users, authentication, refresh tokens, and roles.
- **Catalog:** organizers, venues, events, shows, and pricing.
- **Inventory:** show seats, availability, holds, and expiration.
- **Booking:** booking lifecycle and booking history.
- **Payment:** payment intents, callbacks, refunds, and reconciliation.
- **Notification:** email/in-app delivery through workers.
- **Audit:** security and administrative activity records.
- **Reporting:** organizer statistics and read-optimized queries.

If the system later needs service extraction, Inventory and Notifications are sensible first candidates. Extraction should be based on a documented reason, not simply to claim microservices.

## 7. Critical seat-hold design

PostgreSQL should be the source of truth. Redis may cache availability and help with rate limiting, but correctness must not depend only on a Redis lock.

For each show, create one `show_seat` record per physical seat. A simplified state machine is:

```text
AVAILABLE -> HELD -> BOOKED
               |
               +-> AVAILABLE (release or expiration)
```

`show_seat` contains inventory state, references the permanent physical seat, and points to its
applicable `show_price`; it does not copy monetary values. Each show uses one ISO currency, and
`show_prices` contains one minor-unit amount for every
`(show_id, venue_section_id, seat_category)` combination. When a booking is confirmed, copy the
charged amount and currency to the booking-seat record as the immutable financial record.

### Creating a hold

1. Receive the show ID, seat IDs, and an `Idempotency-Key`.
2. Validate that the show is bookable and the user is allowed to book.
3. Start a PostgreSQL transaction.
4. Lock the requested `show_seat` rows in a consistent order.
5. Confirm every requested seat is available or has an expired hold.
6. Create one hold and its hold-seat records.
7. Update all requested seats to `HELD`, recording the hold ID and expiry time.
8. Write a `SeatHoldCreated` event to an outbox table in the same transaction.
9. Commit and return the hold ID and expiration time.

If any seat is unavailable, the entire transaction fails. This provides all-or-nothing behavior.

### Confirming a booking

1. The user creates a payment intent for an active hold.
2. The payment simulator sends a callback, possibly more than once.
3. The callback is verified and deduplicated using its provider event ID.
4. A transaction locks the hold and associated seats.
5. If already processed, return the stored result.
6. If successful and valid, create the booking and change seats to `BOOKED`.
7. Write `BookingConfirmed` to the outbox table in the same transaction.
8. An outbox worker publishes the event to RabbitMQ.
9. Notification and ticket-generation workers consume the event.

### Expiring holds

- A scheduled worker queries expired holds in small batches.
- It locks each hold, verifies its current state, and releases its seats.
- The job is idempotent, so processing the same hold again is harmless.
- A periodic reconciliation job catches holds missed during downtime.

## 8. Core data model

Important tables:

- `users`
- `roles` and `user_roles`
- `organizers`
- `venues`
- `venue_sections`
- `seats`
- `events`
- `shows`
- `show_prices`
- `show_seats`
- `holds`
- `hold_seats`
- `bookings`
- `booking_seats`
- `payment_intents`
- `payment_events`
- `refunds`
- `outbox_events`
- `idempotency_keys`
- `audit_logs`

Important indexes and constraints:

- Unique physical seat number within a venue section.
- Unique show, venue-section, and seat-category price combination.
- Unique show-seat combination.
- Check constraints for positive show duration, valid three-letter show currency, and non-negative prices.
- Unique payment provider event ID.
- Unique idempotency key within a user and endpoint scope.
- Indexes on event city/date, show start time, hold expiry, booking user, and outbox processing state.

Store money as integer minor units, such as paise, rather than floating-point values.

## 9. Example API surface

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh

GET    /events
GET    /events/:eventId
GET    /shows/:showId/seats

POST   /holds
GET    /holds/:holdId
DELETE /holds/:holdId

POST   /payments/intents
POST   /payments/webhooks/simulator

GET    /bookings
GET    /bookings/:bookingId
POST   /bookings/:bookingId/cancel

POST   /organizer/venues
POST   /organizer/events
POST   /organizer/shows
GET    /organizer/reports/sales
```

Use an `Idempotency-Key` header on hold creation, payment intent creation, cancellation, and other retryable write operations.

## 10. Reliability patterns to implement

- **Database transactions:** preserve booking and inventory invariants.
- **Transactional outbox:** prevent a database update from succeeding while its event is lost.
- **Idempotency:** safely handle client retries and duplicate callbacks.
- **Retry with exponential backoff:** recover from temporary worker failures.
- **Dead-letter queue:** isolate events that repeatedly fail.
- **Timeouts:** prevent calls from waiting indefinitely.
- **Circuit breaker:** optional for the simulated payment dependency.
- **Reconciliation jobs:** repair discrepancies after downtime or partial failures.
- **Graceful shutdown:** stop accepting new traffic and finish in-flight work.

Document the delivery guarantee as **at least once**. Consumers must therefore be idempotent.

### What RabbitMQ should and should not queue

RabbitMQ should absorb asynchronous work such as notifications, ticket generation, hold-expiry processing, payment reconciliation, refunds, analytics, audit events, and cache invalidation. Workers consume these jobs at a controlled rate, can batch suitable database writes, and expose queue depth so the system can detect growing pressure.

Interactive correctness-sensitive requests such as reading a live seat map or attempting a seat hold should not wait inside RabbitMQ. They need an immediate success, conflict, or overload response. During extreme demand, the V2 virtual waiting room controls how many users may reach these APIs.

## 11. Caching strategy

Good Redis candidates:

- frequently requested event and show summaries;
- short-lived seat-map snapshots;
- distributed rate-limit counters;
- revoked refresh-token or session metadata if needed;
- WebSocket fan-out or pub/sub for availability notifications.

Do not treat cached seat availability as authoritative. After a hold or booking, invalidate or update the relevant cache. The database transaction makes the final decision when a user attempts to hold a seat.

## 12. Scalability plan

### Vertical scaling

Initially, increase CPU, memory, database connections, or storage performance on a single machine. This is operationally simple but eventually reaches a limit.

### Horizontal scaling

- Run multiple stateless API containers behind Nginx.
- Keep sessions, rate limits, and shared transient state outside process memory.
- Scale background workers independently based on queue depth.
- Use health checks so unhealthy instances stop receiving traffic.

### Database scaling

Apply these steps in order:

1. Correct indexes and query plans.
2. Connection pooling and bounded concurrency.
3. Cache safe read-heavy endpoints.
4. Add a read replica for catalog and reporting queries.
5. Partition large tables such as audit logs or bookings by date.
6. Design sharding only after measuring a genuine single-database bottleneck.

For a sharding design exercise, show data could be assigned by a stable hash of `show_id`, keeping a show's seat inventory and bookings on the same shard. Cross-shard reporting would then require aggregation. A production-quality sharding implementation is optional and should not replace the more important correctness work.

### Database protection checklist

- Keep API and worker connection pools bounded; more application replicas must not create unlimited database connections.
- Set statement, lock-wait, and transaction timeouts.
- Keep transactions short and lock seat rows in a consistent order.
- Inspect query plans and monitor slow queries before adding infrastructure.
- Use pagination and response limits instead of unbounded reads.
- Batch suitable worker writes without batching interactive seat reservations.
- Send catalog/reporting reads to a replica in V2, while critical inventory decisions stay on the primary.
- Monitor pool utilization, lock contention, replication lag, CPU, memory, and storage latency.
- Test backups and restoration in V2; a backup that has never been restored is unverified.

### Flash-sale traffic protection (V2)

A RabbitMQ message queue and a virtual waiting room solve different problems:

```text
Large user spike
      |
      v
Virtual Waiting Room -- signed admission token, controlled release rate
      |
      v
Nginx Load Balancer -- health checks, request limits, timeouts
      |
      v
Stateless APIs -- per-user/route rate limits, bounded DB pool
      |
      +--> PostgreSQL (authoritative booking decision)
      +--> Redis (cache, counters, queue/admission state)
      +--> RabbitMQ (asynchronous work only)
```

- **Virtual waiting room:** queues people before they create expensive live traffic.
- **Admission control:** adjusts the release rate using API latency, error rate, database utilization, and lock contention.
- **Backpressure:** slows or pauses producers when worker queues or dependencies cannot keep up.
- **Load shedding:** rejects low-priority work with `429` or `503` and a `Retry-After` header before the system collapses.
- **Priority:** protect booking confirmation and payment callbacks ahead of search, reporting, and analytics traffic.
- **Request boundaries:** enforce maximum body sizes, timeouts, pagination limits, and per-route concurrency limits.

## 13. Security requirements

- Hash passwords with Argon2 or bcrypt.
- Rotate refresh tokens and revoke reused token families.
- Validate all DTOs and reject unknown fields where appropriate.
- Apply RBAC and ownership checks on organizer resources.
- Rate-limit login, seat-map refresh, and hold endpoints.
- Apply WAF rules and bot/abuse protection to public flash-sale endpoints in V2.
- Verify payment webhook signatures in the simulator.
- Never log passwords, full tokens, or sensitive payment data.
- Maintain immutable audit records for administrative changes.
- Use parameterized queries and standard HTTP security headers.

## 14. Observability

### Logs

Use structured JSON logs containing a request ID, user ID where appropriate, hold ID, booking ID, route, status, duration, and error code. Propagate a correlation ID through API requests, messages, and workers.

### Metrics

Track:

- request rate, error rate, and latency percentiles;
- active, successful, failed, and expired holds;
- booking success rate;
- payment callback failures and duplicates;
- queue depth, processing time, retry count, and dead-letter count;
- database pool utilization and slow queries;
- cache hit ratio.

### Tracing

Trace important flows such as:

```text
HTTP hold request -> database transaction -> outbox -> RabbitMQ -> worker
```

Create a Grafana dashboard showing system health during load tests.

## 15. Testing strategy

- **Unit tests:** pricing, state transitions, expiry rules, and permissions.
- **Integration tests:** repositories, PostgreSQL transactions, Redis, and RabbitMQ.
- **API tests:** authentication, validation, idempotency, and error contracts.
- **Concurrency tests:** hundreds of clients compete for the same small group of seats; exactly one valid booking per seat must result.
- **Failure tests:** restart workers, delay payments, duplicate messages, and temporarily disconnect dependencies.
- **Load tests:** separate browse-heavy, normal-booking, and flash-sale scenarios using k6.
- **Overload tests (V2):** verify admission control, backpressure, `Retry-After` responses, and recovery after traffic subsides.
- **Recovery tests (V2):** restore a database backup and verify booking invariants after restoration.

The most important automated invariant is:

```text
For every show and seat, confirmed_booking_count <= 1
```

## 16. Implementation roadmap

### Phase 1 - Foundation

- Create the NestJS project, Docker Compose environment, PostgreSQL schema, linting, tests, and CI.
- Implement authentication, roles, error handling, request IDs, and OpenAPI documentation.

### Phase 2 - Catalog

- Implement organizers, venues, seat layouts, events, shows, section/category pricing, and search.
- Generate show-seat inventory and add required indexes.

### Phase 3 - Correct reservations

- Implement the hold state machine and PostgreSQL concurrency control.
- Add expiration, idempotency, and high-contention integration tests.

### Phase 4 - Booking and payments

- Implement the payment simulator, callbacks, booking confirmation, cancellation, and refunds.
- Handle duplicate, delayed, and out-of-order callbacks.

### Phase 5 - Asynchronous architecture

- Add the transactional outbox, RabbitMQ, notification worker, retries, dead-letter queues, and reconciliation.
- At this point, V1 has the complete business flow and reliability foundation.

### Phase 6 - V1 scale and observe

- Add Redis caching and rate limiting.
- Run multiple API and worker instances behind Nginx.
- Add metrics, dashboards, traces, structured logs, and health checks.

### Phase 7 - V1 validate and present

- Run documented k6 scenarios and record the results.
- Create architecture, sequence, data-model, and deployment diagrams.
- Write architecture decision records and a failure-testing report.
- Record a short demo showing concurrent booking attempts and monitoring dashboards.

Completing Phase 7 produces the resume-ready V1. Publish and document it before starting V2.

### Phase 8 - V2 flash-sale protection

- Build the virtual waiting room, signed admission tokens, and configurable release rate.
- Add admission control, per-route concurrency limits, backpressure, and load shedding.
- Add real-time seat updates and reduce seat-map polling.
- Demonstrate that protected booking/payment traffic remains healthy during an overload test.

### Phase 9 - V2 data and operational scaling

- Route suitable catalog/reporting queries to a read replica.
- Partition selected high-growth tables and document the operational trade-offs.
- Add worker autoscaling signals, circuit breakers, WAF/bot controls, and backup/restore tests.
- Document a `show_id` sharding design; implement a small proof of concept only if measured results justify it.

## 17. Repository deliverables

The completed repository should contain:

- a clear README with the problem, features, setup, and demo;
- an architecture diagram and critical booking sequence diagram;
- an entity-relationship diagram;
- OpenAPI documentation;
- Docker Compose setup for the complete local system;
- database migrations and seed data;
- automated unit, integration, concurrency, and load tests;
- Grafana dashboard definitions;
- architecture decision records for major trade-offs;
- measured performance results with hardware and test conditions;
- a failure-scenario table explaining expected recovery behavior.

## 18. Important scope boundaries

To keep the project achievable:

- Use a payment simulator instead of real financial transactions.
- Use generated venues and events rather than integrating external inventory.
- Build a minimal frontend; invest most effort in the backend.
- Begin with one deployable API application, not many microservices.
- Implement horizontal API scaling, but treat database sharding as an optional design extension.
- Complete the V1 checklist before implementing the V2 waiting room, replicas, partitioning, or sharding.
- Prefer a correct reservation system with excellent tests over many unfinished features.

## 19. What makes this project resume-worthy

The finished project should let you truthfully discuss:

- how you prevented double booking under concurrent traffic;
- why PostgreSQL remained the source of truth while Redis improved performance;
- how idempotency handled retries and duplicate payment callbacks;
- how the outbox pattern avoided losing events;
- how multiple API and worker instances scaled independently;
- which bottlenecks appeared in load testing and how you improved them;
- how the system recovered from dependency and worker failures.

Example resume bullets should only be written after implementation and measurement. They might eventually follow this structure:

- Engineered a concurrency-safe ticket reservation backend using NestJS, PostgreSQL, and Redis, preventing double bookings across `<measured concurrency>` competing clients through transactional seat locking and idempotent APIs.
- Designed an event-driven booking workflow with RabbitMQ and the transactional outbox pattern, supporting retry-safe payment callbacks, background notifications, and recovery from worker failures.
- Horizontally scaled stateless API instances behind Nginx and achieved `<actual throughput>` requests/second at `<actual p95 latency>` in reproducible k6 load tests, monitored through OpenTelemetry, Prometheus, and Grafana.

Never publish invented performance numbers. Replace the placeholders only with reproducible results.

## 20. Definition of done

The project is complete when:

- the full customer booking flow works;
- concurrent requests cannot double-book a seat;
- duplicate requests and callbacks are processed safely;
- expired holds are reliably released;
- API and worker replicas can run horizontally;
- important flows have logs, metrics, and traces;
- automated tests cover correctness and failure cases;
- the load-test methodology and actual results are documented;
- another developer can start the entire system from the README.
