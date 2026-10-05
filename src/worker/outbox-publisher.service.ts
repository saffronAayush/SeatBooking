import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { MetricsService } from '../observability/metrics.service';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxEvent, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EVENTS_EXCHANGE, RabbitMqService } from './rabbitmq.service';

@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async publishBatch(isStopping: () => boolean): Promise<void> {
    const limit = this.config.get<number>('WORKER_BATCH_SIZE', 50);
    for (let index = 0; index < limit && !isStopping(); index++) {
      const token = randomUUID();
      const leaseMs = this.config.get<number>('OUTBOX_LEASE_MS', 30000);
      // Commit the claim before contacting RabbitMQ. Lease expiry recovers crashes;
      // the token prevents an old publisher from updating a newer claim.
      const rows = await this.prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
        WITH candidate AS (
          SELECT "id" FROM "outbox_events"
          WHERE "publishedAt" IS NULL AND "availableAt" <= clock_timestamp()
            AND ("lockedUntil" IS NULL OR "lockedUntil" <= clock_timestamp())
          ORDER BY "availableAt", "createdAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE "outbox_events" e
        SET "lockedUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond',
            "lockToken" = ${token}::uuid, "attempts" = "attempts" + 1
        FROM candidate WHERE e."id" = candidate."id" RETURNING e.*
      `);
      const event = rows[0];
      if (!event) return;
      try {
        const carrier = (event.payload as Prisma.JsonObject)?.traceContext;
        const parent =
          carrier && typeof carrier === 'object' && !Array.isArray(carrier)
            ? propagation.extract(ROOT_CONTEXT, carrier)
            : ROOT_CONTEXT;
        await context.with(parent, () =>
          this.rabbit.publish(
            EVENTS_EXCHANGE,
            event.eventType,
            Buffer.from(
              JSON.stringify({
                id: event.id,
                type: event.eventType,
                version: 1,
                aggregateId: event.aggregateId,
                correlationId: event.correlationId,
                occurredAt: event.createdAt.toISOString(),
                payload: event.payload,
              }),
            ),
            {
              messageId: event.id,
              type: event.eventType,
              contentType: 'application/json',
              correlationId: event.correlationId,
              timestamp: Math.floor(event.createdAt.getTime() / 1000),
            },
          ),
        );
        this.metrics.published.inc({ outcome: 'confirmed' });
        await this.prisma.outboxEvent.updateMany({
          where: { id: event.id, lockToken: token, publishedAt: null },
          data: { publishedAt: new Date(), lockedUntil: null, lockToken: null, lastError: null },
        });
      } catch {
        this.metrics.published.inc({ outcome: 'deferred' });
        const delay = Math.min(1000 * 2 ** Math.min(event.attempts - 1, 8), 60000);
        await this.prisma.outboxEvent.updateMany({
          where: { id: event.id, lockToken: token, publishedAt: null },
          data: {
            availableAt: new Date(Date.now() + delay),
            lockedUntil: null,
            lockToken: null,
            lastError: 'PUBLISH_NOT_CONFIRMED',
          },
        });
        this.logger.warn(
          { eventId: event.id, correlationId: event.correlationId, attempt: event.attempts },
          'Outbox publish deferred',
        );
        // Outages must not exhaust the retry budget of committed business events.
        return;
      }
    }
  }
}
