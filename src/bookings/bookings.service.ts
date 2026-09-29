import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  RefundStatus,
  ShowSeatStatus,
} from '../generated/prisma/client';
import { replayResponse, requestHash, requireIdempotencyKey } from '../common/idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { BookingQueryDto } from './dto/booking-query.dto';

const bookingInclude = {
  paymentIntent: { select: { id: true, status: true } },
  refund: true,
  hold: { select: { id: true, showId: true } },
  seats: {
    orderBy: { showSeatId: 'asc' as const },
    include: {
      showSeat: {
        include: {
          show: { select: { id: true, startsAt: true, endsAt: true, event: { select: { id: true, title: true } } } },
          seat: { include: { section: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: BookingQueryDto) {
    const where: Prisma.BookingWhereInput = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      include: bookingInclude,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async cancel(userId: string, bookingId: string, keyHeader: string | undefined) {
    const key = requireIdempotencyKey(keyHeader);
    const scope = `POST:/bookings/${bookingId}/cancel`;
    const hash = requestHash({ bookingId });

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${scope}:${key}`}, 0))
      `);
      const firstReplay = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (firstReplay !== undefined) return firstReplay;

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE
      `);
      const replayAfterLock = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (replayAfterLock !== undefined) return replayAfterLock;

      const booking = await tx.booking.findFirst({
        where: { id: bookingId, userId },
        include: { seats: true, hold: { include: { show: { select: { startsAt: true } } } } },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new ConflictException('Only confirmed bookings can be cancelled');
      }
      if (booking.hold.show.startsAt <= new Date()) {
        throw new ConflictException('A booking cannot be cancelled after the show starts');
      }

      const seatIds = booking.seats.map((seat) => seat.showSeatId).sort();
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "show_seats"
        WHERE "id" IN (${Prisma.join(seatIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `);
      await tx.showSeat.updateMany({
        where: { id: { in: seatIds }, status: ShowSeatStatus.BOOKED },
        data: { status: ShowSeatStatus.AVAILABLE },
      });
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.refund.create({
        data: {
          bookingId,
          amountMinor: booking.totalMinor,
          currency: booking.currency,
          status: RefundStatus.SUCCEEDED,
          refundedAt: new Date(),
        },
      });
      const response = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: bookingInclude,
      });
      await tx.idempotencyKey.create({
        data: { userId, scope, key, requestHash: hash, response: this.asJson(response) },
      });
      return response;
    });
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
