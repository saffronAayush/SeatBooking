import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingStatus,
  HoldStatus,
  PaymentEventOutcome,
  PaymentEventStatus,
  PaymentIntentStatus,
  Prisma,
  ShowSeatStatus,
} from '../generated/prisma/client';
import { replayResponse, requestHash, requireIdempotencyKey } from '../common/idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createIntent(
    userId: string,
    keyHeader: string | undefined,
    dto: CreatePaymentIntentDto,
  ) {
    const key = requireIdempotencyKey(keyHeader);
    const scope = 'POST:/payments/intents';
    const hash = requestHash(dto);

    return this.prisma.$transaction(async (tx) => {
      await this.lockIdempotencyKey(tx, userId, scope, key);
      const firstReplay = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (firstReplay !== undefined) return firstReplay;

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "holds" WHERE "id" = ${dto.holdId}::uuid FOR UPDATE
      `);
      const replayAfterLock = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (replayAfterLock !== undefined) return replayAfterLock;

      const hold = await tx.hold.findFirst({
        where: { id: dto.holdId, userId },
        include: { seats: true },
      });
      if (!hold) throw new NotFoundException('Hold not found');
      if (hold.status !== HoldStatus.ACTIVE || hold.expiresAt <= new Date()) {
        throw new ConflictException('Hold is not active');
      }
      const currencies = new Set(hold.seats.map((seat) => seat.currency));
      if (currencies.size !== 1) throw new ConflictException('Hold uses mixed currencies');

      const response = await tx.paymentIntent.create({
        data: {
          userId,
          holdId: hold.id,
          amountMinor: hold.seats.reduce((sum, seat) => sum + seat.priceMinor, 0),
          currency: hold.seats[0].currency,
        },
      });
      await tx.idempotencyKey.create({
        data: { userId, scope, key, requestHash: hash, response: this.asJson(response) },
      });
      return response;
    });
  }

  verifySimulatorSignature(signature: string | undefined, dto: PaymentCallbackDto): void {
    if (!signature) throw new UnauthorizedException('Missing simulator signature');
    const expected = createHmac(
      'sha256',
      this.config.getOrThrow<string>('PAYMENT_SIMULATOR_SECRET'),
    )
      .update(this.signaturePayload(dto))
      .digest('hex');
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid simulator signature');
    }
  }

  async processCallback(dto: PaymentCallbackDto, expectedUserId?: string) {
    const existing = await this.prisma.paymentEvent.findUnique({
      where: { providerEventId: dto.providerEventId },
      include: { paymentIntent: { select: { userId: true } } },
    });
    if (existing) {
      this.validateDuplicate(existing, dto, expectedUserId);
      return existing.response;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${dto.providerEventId}, 0))
      `);
      const serializedDuplicate = await tx.paymentEvent.findUnique({
        where: { providerEventId: dto.providerEventId },
        include: { paymentIntent: { select: { userId: true } } },
      });
      if (serializedDuplicate) {
        this.validateDuplicate(serializedDuplicate, dto, expectedUserId);
        return serializedDuplicate.response;
      }
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "payment_intents"
        WHERE "id" = ${dto.paymentIntentId}::uuid FOR UPDATE
      `);
      const duplicate = await tx.paymentEvent.findUnique({
        where: { providerEventId: dto.providerEventId },
        include: { paymentIntent: { select: { userId: true } } },
      });
      if (duplicate) {
        this.validateDuplicate(duplicate, dto, expectedUserId);
        return duplicate.response;
      }

      const intent = await tx.paymentIntent.findUnique({
        where: { id: dto.paymentIntentId },
        include: { hold: { include: { seats: true } }, booking: true },
      });
      if (!intent || (expectedUserId && intent.userId !== expectedUserId)) {
        throw new NotFoundException('Payment intent not found');
      }

      if (intent.status !== PaymentIntentStatus.PENDING) {
        const response = {
          paymentIntentId: intent.id,
          paymentStatus: intent.status,
          bookingId: intent.booking?.id ?? null,
          callbackStatus: PaymentEventStatus.IGNORED,
          message: 'Payment intent was already finalized',
        };
        await this.recordEvent(tx, dto, PaymentEventStatus.IGNORED, response);
        return response;
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "holds" WHERE "id" = ${intent.holdId}::uuid FOR UPDATE
      `);
      await this.lockHoldSeats(tx, intent.holdId);

      if (dto.outcome === PaymentEventOutcome.FAILED) {
        const response = await this.failPayment(tx, intent.id, intent.holdId, 'PROVIDER_DECLINED');
        await this.recordEvent(tx, dto, PaymentEventStatus.PROCESSED, response);
        return response;
      }

      const currentHold = await tx.hold.findUnique({ where: { id: intent.holdId } });
      const seatsStillHeld = await tx.showSeat.count({
        where: {
          activeHoldId: intent.holdId,
          status: ShowSeatStatus.HELD,
          holdExpiresAt: { gt: new Date() },
        },
      });
      if (
        !currentHold ||
        currentHold.status !== HoldStatus.ACTIVE ||
        currentHold.expiresAt <= new Date() ||
        seatsStillHeld !== intent.hold.seats.length
      ) {
        const response = await this.failPayment(tx, intent.id, intent.holdId, 'HOLD_EXPIRED');
        await this.recordEvent(tx, dto, PaymentEventStatus.PROCESSED, response);
        return response;
      }

      const booking = await tx.booking.create({
        data: {
          userId: intent.userId,
          holdId: intent.holdId,
          paymentIntentId: intent.id,
          totalMinor: intent.amountMinor,
          currency: intent.currency,
          status: BookingStatus.CONFIRMED,
          seats: {
            create: intent.hold.seats.map((seat) => ({
              showSeatId: seat.showSeatId,
              priceMinor: seat.priceMinor,
              currency: seat.currency,
            })),
          },
        },
      });
      await tx.showSeat.updateMany({
        where: { activeHoldId: intent.holdId, status: ShowSeatStatus.HELD },
        data: { status: ShowSeatStatus.BOOKED, activeHoldId: null, holdExpiresAt: null },
      });
      await tx.hold.update({
        where: { id: intent.holdId },
        data: { status: HoldStatus.CONVERTED },
      });
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.SUCCEEDED },
      });
      const response = {
        paymentIntentId: intent.id,
        paymentStatus: PaymentIntentStatus.SUCCEEDED,
        bookingId: booking.id,
        callbackStatus: PaymentEventStatus.PROCESSED,
      };
      await this.recordEvent(tx, dto, PaymentEventStatus.PROCESSED, response);
      return response;
    });
  }

  private async failPayment(
    tx: Prisma.TransactionClient,
    paymentIntentId: string,
    holdId: string,
    reason: string,
  ) {
    await tx.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { status: PaymentIntentStatus.FAILED, failureReason: reason },
    });
    await tx.showSeat.updateMany({
      where: { activeHoldId: holdId, status: ShowSeatStatus.HELD },
      data: { status: ShowSeatStatus.AVAILABLE, activeHoldId: null, holdExpiresAt: null },
    });
    await tx.hold.updateMany({
      where: { id: holdId, status: HoldStatus.ACTIVE },
      data: { status: reason === 'HOLD_EXPIRED' ? HoldStatus.EXPIRED : HoldStatus.RELEASED, releasedAt: new Date() },
    });
    return {
      paymentIntentId,
      paymentStatus: PaymentIntentStatus.FAILED,
      bookingId: null,
      callbackStatus: PaymentEventStatus.PROCESSED,
      failureReason: reason,
    };
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    dto: PaymentCallbackDto,
    status: PaymentEventStatus,
    response: unknown,
  ): Promise<void> {
    await tx.paymentEvent.create({
      data: {
        providerEventId: dto.providerEventId,
        paymentIntentId: dto.paymentIntentId,
        outcome: dto.outcome,
        status,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        response: this.asJson(response),
      },
    });
  }

  private validateDuplicate(
    event: {
      paymentIntentId: string;
      outcome: PaymentEventOutcome;
      paymentIntent: { userId: string };
    },
    dto: PaymentCallbackDto,
    expectedUserId?: string,
  ): void {
    if (
      event.paymentIntentId !== dto.paymentIntentId ||
      event.outcome !== dto.outcome ||
      (expectedUserId && event.paymentIntent.userId !== expectedUserId)
    ) {
      throw new ConflictException('Provider event ID was already used for another callback');
    }
  }

  private async lockHoldSeats(tx: Prisma.TransactionClient, holdId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT ss."id" FROM "show_seats" ss
      INNER JOIN "hold_seats" hs ON hs."showSeatId" = ss."id"
      WHERE hs."holdId" = ${holdId}::uuid ORDER BY ss."id" FOR UPDATE OF ss
    `);
  }

  private async lockIdempotencyKey(
    tx: Prisma.TransactionClient,
    userId: string,
    scope: string,
    key: string,
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${scope}:${key}`}, 0))
    `);
  }

  private signaturePayload(dto: PaymentCallbackDto): string {
    return [dto.paymentIntentId, dto.providerEventId, dto.outcome, dto.occurredAt ?? ''].join('.');
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
