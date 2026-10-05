# Phase 5: asynchronous processing

## Business flow

The API commits business state and an `outbox_events` row in one PostgreSQL transaction.
It never waits for RabbitMQ. The independent `dist/worker.js` process runs the publisher,
notification/ticket consumer, hold expiry, and reconciliation loops.

```text
API transaction -> PostgreSQL business rows + outbox
                         |
                  leased outbox publisher
                         |
                 RabbitMQ seatforge.events
                         |
                 seatforge.notifications
                         |
               notification/ticket transaction
                  + consumed-event receipt
                         |
                       ACK
```

Every event has a UUID, type, version, aggregate ID, correlation ID, occurrence time, and JSON
payload. API request IDs propagate into events; recovery events use their aggregate ID as the
correlation ID. Recipients and financial details are read from PostgreSQL by the consumer.

| Event | Worker behavior |
| --- | --- |
| `SeatHoldCreated`, `SeatHoldReleased`, `SeatHoldExpired` | Record receipt; retained as extension points for later inventory consumers |
| `BookingConfirmed` | Generate one JSON ticket and one in-app notification, unless already cancelled |
| `BookingCancelled` | Void any existing ticket and create a cancellation notification |
| `RefundSucceeded` | Create a simulated-refund notification |
| `PaymentFailed` | Create an unsuccessful-payment notification |

Refund simulation and booking confirmation retain their Phase 4 transactional behavior.
The worker does not contact a real payment or email provider. Tickets contain the show, venue,
seat labels, price snapshots, and a unique ticket code. They are JSON records, not PDFs or an
admission/check-in system.

## Delivery and ordering

Delivery is **at least once**. Publisher claims use `FOR UPDATE SKIP LOCKED`, a lease, and a
unique claim token. RabbitMQ persistent messages use mandatory routing and publisher confirms.
Only a confirmed, routed publish marks an outbox row published. Publication failures remain
pending with exponential backoff capped at 60 seconds; there is no broker-outage retry limit.
A crash after publishing but before marking the row published can deliver the same event again.

The consumer commits its receipt, notification, and ticket in one database transaction before
acknowledging. A per-consumer/event advisory lock and unique keys prevent duplicate effects
across worker replicas. A failed transaction leaves no receipt. A broker disconnect leaves
unfinished messages available for redelivery.

There is no global or per-booking delivery ordering guarantee. Both cancellation and ticket
generation lock the booking row. Cancellation voids an existing ticket synchronously; a late
confirmation consumer checks current booking state and skips ticket generation and confirmation
notification for a cancelled booking. Cancellation and refund notifications can arrive in either
order. Consumers added later must also tolerate duplicate and out-of-order events.

## Retries and dead letters

The durable topic exchange `seatforge.events` routes supported event types to the quorum queue
`seatforge.notifications`. A processing failure is confirm-published to `seatforge.retry` using
the route `seatforge.notifications.N`. The original is acknowledged only after that publish
succeeds. The corresponding `seatforge.notifications.retry.N` quorum queue has a fixed TTL and
dead-letters back to the work queue. Defaults are five retries at 1, 2, 4, 8, and 16 seconds.

Invalid envelopes go directly to `seatforge.notifications.dead` through `seatforge.dead`.
Exhausted retries go there too, carrying `x-retry-count` and a safe `x-failure-reason` code.
The work queue also has a broker delivery limit of 20 to isolate repeated connection-level
redeliveries. Retry and work queues use quorum at-least-once dead-lettering with reject-publish
overflow. The local Compose broker is a single node: its persistent volume protects restarts,
but this is not a multi-node high-availability deployment.

## Recovery

| Failure | Recovery |
| --- | --- |
| RabbitMQ unavailable | API writes succeed; outbox publishing reconnects and retries |
| Publisher stops while holding a lease | Another worker can claim the row when the lease expires |
| Consumer stops before commit | Database rolls back; unacknowledged message is redelivered |
| Consumer commits before ACK is lost | Receipt makes redelivery a no-op |
| Retry/DLQ publication fails | Original remains unacknowledged; reconnect triggers redelivery |
| Worker downtime leaves expired holds | Startup and repeated batches expire them with ordered seat locks |
| Payment callback never arrives | Reconciliation fails pending intents after hold expiry/release/conversion |
| Callback arrives after reconciliation | Existing terminal payment rules ignore it; it cannot create a booking |
| Older booking/refund lacks an outbox event | Reconciliation inserts the missing event with a stable event key |
| PostgreSQL unavailable | Work remains uncommitted; sweeps retry and messages retry or reach the DLQ |

Each scheduled loop waits for completion before scheduling again. Hold and payment recovery
use small transactions and `SKIP LOCKED`; expiry does not wait for RabbitMQ. Pending payments
with a still-active, unexpired hold are left alone. The simulator has no external settlement
ledger to query and reconciliation never invents a successful charge.

Each process has a bounded 10-connection PostgreSQL pool, a 5-second connection timeout,
a 10-second statement timeout, and a 3-second lock timeout so dependency failures return to
the retry loops. Prisma's existing transaction timeout still bounds interactive transactions.

Missing-event recovery is bounded per sweep and handles pre-Phase-5 bookings and successful
refunds. It does not erase receipts or automatically replay poison messages. Event and receipt
retention is intentionally conservative: do not delete them without designing a replay horizon.

## Operations

Start with `docker compose up --build`, or run PostgreSQL/RabbitMQ in Compose and use
`npm run dev` plus `npm run worker` after generating Prisma and building. The worker requires
the new `202610030001_async_architecture` migration. Docker runs migrations once before either
application starts. The worker has no HTTP listener and does not import API controllers.

Inspect queue depth and dead letters at <http://localhost:15672>. Inspect pending outbox work:

```sql
SELECT "id", "eventType", "attempts", "availableAt", "lockedUntil", "lastError"
FROM "outbox_events" WHERE "publishedAt" IS NULL
ORDER BY "createdAt" LIMIT 100;
```

After fixing the cause of a dead letter, use its `messageId` to locate the original outbox row.
An operator can replay that one event with the following SQL, replacing the example UUID:

```sql
UPDATE "outbox_events" e
SET "publishedAt" = NULL, "availableAt" = CURRENT_TIMESTAMP,
    "lockedUntil" = NULL, "lockToken" = NULL, "lastError" = NULL
WHERE e."id" = '00000000-0000-4000-8000-000000000000'::uuid
  AND (e."lockedUntil" IS NULL OR e."lockedUntil" <= CURRENT_TIMESTAMP)
  AND NOT EXISTS (
    SELECT 1 FROM "consumed_events" c
    WHERE c."eventId" = e."id" AND c."consumer" = 'booking-notifications-v1'
  );
```

The publisher reconstructs the original envelope without the retry headers. Verify the receipt
and resulting notification/ticket, then remove that dead-letter copy using the management UI.
Do not purge the whole queue to replay a single event. An invalid envelope with no matching
outbox row requires operator investigation rather than automatic replay.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RABBITMQ_URL` | local broker, heartbeat 10 seconds | AMQP connection; use deployment credentials outside local development |
| `RABBITMQ_TIMEOUT_MS` | 5000 | Socket connection and publish-confirm timeout |
| `WORKER_PREFETCH` | 10 | Maximum unacknowledged deliveries per worker |
| `WORKER_BATCH_SIZE` | 50 | Maximum records per background sweep |
| `WORKER_RECONNECT_MS` | 5000 | Consumer reconnect check interval |
| `WORKER_MAX_RETRIES` | 5 | Delayed retries before dead-lettering |
| `WORKER_RETRY_BASE_MS` | 1000 | Initial retry delay |
| `WORKER_RETRY_MAX_MS` | 60000 | Retry delay cap |
| `OUTBOX_POLL_INTERVAL_MS` | 1000 | Pause between publisher batches |
| `OUTBOX_LEASE_MS` | 30000 | Recoverable publisher lease; must exceed confirm timeout |
| `HOLD_EXPIRY_INTERVAL_MS` | 5000 | Pause between hold-expiry batches |
| `RECONCILIATION_INTERVAL_MS` | 30000 | Pause between payment/event recovery batches |

RabbitMQ queue arguments are immutable. Keep retry topology settings identical across worker
replicas. Changing retry TTLs on an existing installation requires draining and replacing the
affected retry queues (or introducing a versioned topology) during maintenance.

Shutdown stops new scheduled jobs, drains active work and deliveries, then closes RabbitMQ
before disconnecting Prisma. Compose allows 60 seconds; interrupted work recovers from leases,
unacknowledged deliveries, or the next database sweep. Production metrics, dashboards, tracing,
and additional health probes remain Phase 6 work. No automated tests were added for this phase.
