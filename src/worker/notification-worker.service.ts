import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsumeMessage } from 'amqplib';
import { BookingStatus, Prisma, RefundStatus, TicketStatus } from '../generated/prisma/client';
import { DomainEvent, parseEvent } from '../outbox/domain-event';
import { PrismaService } from '../prisma/prisma.service';
import { DEAD_EXCHANGE, RETRY_EXCHANGE, RabbitMqService, WORK_QUEUE } from './rabbitmq.service';

const CONSUMER = 'booking-notifications-v1';

@Injectable()
export class NotificationWorkerService {
  private readonly logger = new Logger(NotificationWorkerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    private readonly config: ConfigService,
  ) {}

  async handle(message: ConsumeMessage): Promise<void> {
    let event: DomainEvent;
    try {
      event = parseEvent(message.content, message.properties.messageId);
    } catch {
      await this.forwardFailure(message, true, 'INVALID_EVENT');
      return;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${`${CONSUMER}:${event.id}`}, 0))
        `);
        const receipt = await tx.consumedEvent.findUnique({
          where: { consumer_eventId: { consumer: CONSUMER, eventId: event.id } },
        });
        if (receipt) return;
        // Read recipients and monetary data from PostgreSQL, never from broker payloads.
        const source = await tx.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        if (source.eventType !== event.type || source.aggregateId !== event.aggregateId) {
          throw new Error('EVENT_SOURCE_MISMATCH');
        }
        await this.applyEvent(tx, event);
        await tx.consumedEvent.create({ data: { consumer: CONSUMER, eventId: event.id } });
      });
      this.logger.log(
        { eventId: event.id, eventType: event.type, correlationId: event.correlationId },
        'Business event processed',
      );
    } catch {
      await this.forwardFailure(message, false, 'PROCESSING_FAILED');
    }
  }

  private async applyEvent(tx: Prisma.TransactionClient, event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'BookingConfirmed':
      case 'BookingCancelled': {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "bookings" WHERE "id" = ${event.aggregateId}::uuid FOR UPDATE
        `);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: event.aggregateId },
          include: {
            hold: { include: { show: { include: { event: true, venue: true } } } },
            seats: {
              orderBy: { showSeatId: 'asc' },
              include: {
                showSeat: { include: { seat: { include: { section: true } } } },
              },
            },
          },
        });
        const show = booking.hold.show;
        if (booking.status === BookingStatus.CANCELLED) {
          await tx.ticket.updateMany({
            where: { bookingId: booking.id, status: TicketStatus.ACTIVE },
            data: { status: TicketStatus.VOID, voidedAt: booking.cancelledAt ?? new Date() },
          });
          if (event.type === 'BookingConfirmed') return;
          await this.notify(
            tx,
            event,
            booking.userId,
            'Booking cancelled',
            `Your booking for ${show.event.title} has been cancelled.`,
            { bookingId: booking.id },
          );
          return;
        }
        if (event.type !== 'BookingConfirmed') throw new Error('BOOKING_STATE_MISMATCH');
        const snapshot = {
          bookingId: booking.id,
          showId: show.id,
          eventTitle: show.event.title,
          startsAt: show.startsAt.toISOString(),
          endsAt: show.endsAt.toISOString(),
          venue: {
            name: show.venue.name,
            city: show.venue.city,
            address: show.venue.address,
            timezone: show.venue.timezone,
          },
          totalMinor: booking.totalMinor,
          currency: booking.currency,
          seats: booking.seats.map((item) => ({
            showSeatId: item.showSeatId,
            section: item.showSeat.seat.section.name,
            rowLabel: item.showSeat.seat.rowLabel,
            seatNumber: item.showSeat.seat.seatNumber,
            category: item.showSeat.seat.category,
            priceMinor: item.priceMinor,
            currency: item.currency,
          })),
        };
        await tx.ticket.upsert({
          where: { bookingId: booking.id },
          create: { bookingId: booking.id, snapshot },
          update: {},
        });
        await this.notify(
          tx,
          event,
          booking.userId,
          'Booking confirmed',
          `Your booking for ${show.event.title} is confirmed. Your ticket is ready.`,
          { bookingId: booking.id },
        );
        return;
      }
      case 'RefundSucceeded': {
        const refund = await tx.refund.findUniqueOrThrow({
          where: { id: event.aggregateId },
          include: { booking: { select: { userId: true } } },
        });
        if (refund.status !== RefundStatus.SUCCEEDED) throw new Error('REFUND_STATE_MISMATCH');
        await this.notify(
          tx,
          event,
          refund.booking.userId,
          'Refund completed',
          'Your simulated refund has been completed.',
          {
            bookingId: refund.bookingId,
            refundId: refund.id,
            amountMinor: refund.amountMinor,
            currency: refund.currency,
          },
        );
        return;
      }
      case 'PaymentFailed': {
        const intent = await tx.paymentIntent.findUniqueOrThrow({
          where: { id: event.aggregateId },
        });
        await this.notify(
          tx,
          event,
          intent.userId,
          'Payment unsuccessful',
          'This payment did not complete. Start a new reservation to try again.',
          {
            paymentIntentId: intent.id,
            holdId: intent.holdId,
            reason: intent.failureReason,
          },
        );
        return;
      }
      // Inventory events are durable extension points for Phase 6 cache invalidation
      // and V2 realtime updates. Expiry correctness stays in PostgreSQL.
      case 'SeatHoldCreated':
      case 'SeatHoldReleased':
      case 'SeatHoldExpired':
        return;
    }
  }

  private async notify(
    tx: Prisma.TransactionClient,
    event: DomainEvent,
    userId: string,
    title: string,
    message: string,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.notification.create({
      data: { eventId: event.id, userId, kind: event.type, title, message, data },
    });
  }

  private async forwardFailure(
    message: ConsumeMessage,
    permanent: boolean,
    reason: string,
  ): Promise<void> {
    const rawAttempt: unknown = message.properties.headers?.['x-retry-count'];
    const attempt =
      typeof rawAttempt === 'number' && Number.isInteger(rawAttempt) && rawAttempt >= 0
        ? rawAttempt
        : 0;
    const dead = permanent || attempt >= this.config.get<number>('WORKER_MAX_RETRIES', 5);
    await this.rabbit.publish(
      dead ? DEAD_EXCHANGE : RETRY_EXCHANGE,
      dead ? WORK_QUEUE : `${WORK_QUEUE}.${attempt + 1}`,
      message.content,
      {
        messageId: message.properties.messageId,
        type: message.properties.type,
        contentType: message.properties.contentType,
        correlationId: message.properties.correlationId,
        headers: { 'x-retry-count': dead ? attempt : attempt + 1, 'x-failure-reason': reason },
      },
    );
    // The caller acknowledges the original only after this publish is confirmed.
    this.logger.warn(
      { eventId: message.properties.messageId, attempt, reason },
      dead ? 'Event moved to dead-letter queue' : 'Event scheduled for retry',
    );
  }
}
