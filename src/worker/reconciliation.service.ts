import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  async reconcilePayments(isStopping: () => boolean): Promise<void> {
    const count = await this.payments.reconcilePending(
      this.config.get<number>('WORKER_BATCH_SIZE', 50),
      isStopping,
    );
    if (count > 0) this.logger.log({ count }, 'Unfinished payments reconciled');
  }

  async repairMissingEvents(isStopping: () => boolean): Promise<void> {
    const limit = this.config.get<number>('WORKER_BATCH_SIZE', 50);
    // Includes pre-Phase-5 records. Stable keys only fill missing events; they do
    // not republish dead-lettered work or bypass consumer retry limits.
    const bookings = await this.prisma.$queryRaw<
      Array<{ id: string; userId: string; status: string }>
    >(Prisma.sql`
      SELECT b."id", b."userId", b."status" FROM "bookings" b
      WHERE NOT EXISTS (SELECT 1 FROM "outbox_events" e WHERE e."eventKey" = 'BookingConfirmed:' || b."id"::text)
        OR (b."status" = 'CANCELLED' AND NOT EXISTS (
          SELECT 1 FROM "outbox_events" e WHERE e."eventKey" = 'BookingCancelled:' || b."id"::text))
      ORDER BY b."createdAt", b."id" LIMIT ${limit}
    `);
    for (const booking of bookings) {
      if (isStopping()) return;
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.record(tx, 'BookingConfirmed', booking.id, { userId: booking.userId });
        if (booking.status === 'CANCELLED') {
          await this.outbox.record(tx, 'BookingCancelled', booking.id, { userId: booking.userId });
        }
      });
    }
    if (isStopping()) return;
    const refunds = await this.prisma.$queryRaw<
      Array<{ id: string; bookingId: string }>
    >(Prisma.sql`
      SELECT r."id", r."bookingId" FROM "refunds" r WHERE r."status" = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM "outbox_events" e WHERE e."eventKey" = 'RefundSucceeded:' || r."id"::text)
      ORDER BY r."createdAt", r."id" LIMIT ${limit}
    `);
    for (const refund of refunds) {
      if (isStopping()) return;
      await this.prisma.$transaction((tx) =>
        this.outbox.record(tx, 'RefundSucceeded', refund.id, {
          bookingId: refund.bookingId,
        }),
      );
    }
    if (bookings.length + refunds.length > 0) {
      this.logger.log(
        { bookings: bookings.length, refunds: refunds.length },
        'Missing business events recovered',
      );
    }
  }
}
