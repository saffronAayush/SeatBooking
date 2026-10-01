import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventStatus,
  HoldStatus,
  Prisma,
  ShowSeatStatus,
  ShowStatus,
} from '../generated/prisma/client';
import { replayResponse, requestHash, requireIdempotencyKey } from '../common/idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHoldDto } from './dto/create-hold.dto';

const holdInclude = {
  seats: {
    orderBy: { showSeatId: 'asc' as const },
    include: {
      showSeat: {
        include: {
          seat: {
            include: { section: { select: { id: true, name: true, sortOrder: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.HoldInclude;

// TODO: use socket for hold and unhold.
@Injectable()
export class ReservationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationsService.name);
  private expiryTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>('HOLD_EXPIRY_INTERVAL_MS', 5000);
    // TODO: Prevent overlapping expiry sweeps when a previous sweep is still running.
    this.expiryTimer = setInterval(() => {
      void this.expireDueHolds().catch((error: unknown) =>
        this.logger.error('Hold expiry sweep failed', error),
      );
    }, intervalMs);
    this.expiryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  async create(userId: string, keyHeader: string | undefined, dto: CreateHoldDto) {
    const key = requireIdempotencyKey(keyHeader);
    const showSeatIds = [...new Set(dto.showSeatIds)].sort();
    if (showSeatIds.length !== dto.showSeatIds.length) {
      throw new BadRequestException('showSeatIds must not contain duplicates');
    }
    const hash = requestHash({ showId: dto.showId, showSeatIds });
    const scope = 'POST:/holds';

    return this.prisma.$transaction(async (tx) => {
      await this.lockIdempotencyKey(tx, userId, scope, key);
      const initialReplay = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (initialReplay !== undefined) return initialReplay;

      // TODO: Coordinate show cancellation and price updates with hold creation using row locks.
      const show = await tx.show.findFirst({
        where: {
          id: dto.showId,
          status: ShowStatus.SCHEDULED,
          event: { status: EventStatus.PUBLISHED },
        },
        select: { id: true, startsAt: true },
      });
      if (!show) throw new NotFoundException('Bookable show not found');
      if (show.startsAt <= new Date()) throw new ConflictException('This show has already started');

      // TODO: Review transaction and PostgreSQL lock timeouts for requests waiting on seats.
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "show_seats"
        WHERE "showId" = ${dto.showId}::uuid
          AND "id" IN (${Prisma.join(showSeatIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `);

      const seats = await tx.showSeat.findMany({
        where: { id: { in: showSeatIds }, showId: dto.showId },
        orderBy: { id: 'asc' },
        include: {
          show: { select: { currency: true } },
          showPrice: { select: { priceMinor: true } },
        },
      });
      if (seats.length !== showSeatIds.length) {
        throw new BadRequestException('One or more seats do not belong to this show');
      }
      const unavailable = seats.filter((seat) => seat.status !== ShowSeatStatus.AVAILABLE);
      if (unavailable.length > 0) {
        throw new ConflictException({
          message: 'One or more requested seats are unavailable',
          unavailableSeatIds: unavailable.map((seat) => seat.id),
        });
      }

      const currencies = new Set(seats.map((seat) => seat.show.currency));
      if (currencies.size !== 1) throw new ConflictException('Selected seats use mixed currencies');
      // TODO(v2): Detect price changes between seat display and hold creation, return the latest
      // price, and require explicit customer confirmation before creating the hold.
      const ttlSeconds = this.config.get<number>('HOLD_TTL_SECONDS', 300);
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const hold = await tx.hold.create({
        data: {
          userId,
          showId: dto.showId,
          expiresAt,
          seats: {
            create: seats.map((seat) => ({
              showSeatId: seat.id,
            priceMinor: seat.showPrice.priceMinor,
            currency: seat.show.currency,
            })),
          },
        },
      });
      // TODO: Verify the update count matches the number of requested seats.
      await tx.showSeat.updateMany({
        where: { id: { in: showSeatIds }, status: ShowSeatStatus.AVAILABLE },
        data: { status: ShowSeatStatus.HELD, activeHoldId: hold.id, holdExpiresAt: expiresAt },
      });

      const response = await tx.hold.findUniqueOrThrow({
        where: { id: hold.id },
        include: holdInclude,
      });
      // TODO: Add retention and cleanup for old idempotency-key records.
      await tx.idempotencyKey.create({
        data: { userId, scope, key, requestHash: hash, response: this.asJson(response) },
      });
      return response;
    });
  }

  async get(userId: string, holdId: string) {
    let hold = await this.prisma.hold.findFirst({
      where: { id: holdId, userId },
      include: holdInclude,
    });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.status === HoldStatus.ACTIVE && hold.expiresAt <= new Date()) {
      await this.expireOne(hold.id);
      hold = await this.prisma.hold.findFirst({
        where: { id: holdId, userId },
        include: holdInclude,
      });
    }
    return hold;
  }

  async release(userId: string, holdId: string, keyHeader: string | undefined) {
    const key = requireIdempotencyKey(keyHeader);
    const scope = `DELETE:/holds/${holdId}`;
    const hash = requestHash({ holdId });

    return this.prisma.$transaction(async (tx) => {
      await this.lockIdempotencyKey(tx, userId, scope, key);
      const replay = replayResponse(
        await tx.idempotencyKey.findUnique({
          where: { userId_scope_key: { userId, scope, key } },
        }),
        hash,
      );
      if (replay !== undefined) return replay;

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "holds" WHERE "id" = ${holdId}::uuid FOR UPDATE`,
      );
      const hold = await tx.hold.findFirst({ where: { id: holdId, userId } });
      if (!hold) throw new NotFoundException('Hold not found');
      if (hold.status !== HoldStatus.ACTIVE) {
        throw new ConflictException(`Hold is already ${hold.status.toLowerCase()}`);
      }

      await this.lockHoldSeats(tx, holdId);
      const now = new Date();
      const status = hold.expiresAt <= now ? HoldStatus.EXPIRED : HoldStatus.RELEASED;
      await tx.showSeat.updateMany({
        where: { activeHoldId: holdId, status: ShowSeatStatus.HELD },
        data: { status: ShowSeatStatus.AVAILABLE, activeHoldId: null, holdExpiresAt: null },
      });
      const response = await tx.hold.update({
        where: { id: holdId },
        data: { status, releasedAt: now },
        include: holdInclude,
      });
      await tx.idempotencyKey.create({
        data: { userId, scope, key, requestHash: hash, response: this.asJson(response) },
      });
      return response;
    });
  }

  async expireDueHolds(): Promise<void> {
    // TODO: Add pagination or repeated batch processing for more than 100 expired holds.
    const due = await this.prisma.hold.findMany({
      where: { status: HoldStatus.ACTIVE, expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    for (const hold of due) await this.expireOne(hold.id);
  }

  private async expireOne(holdId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "holds" WHERE "id" = ${holdId}::uuid FOR UPDATE`,
      );
      const hold = await tx.hold.findUnique({ where: { id: holdId } });
      if (!hold || hold.status !== HoldStatus.ACTIVE || hold.expiresAt > new Date()) return;
      await this.lockHoldSeats(tx, holdId);
      await tx.showSeat.updateMany({
        where: { activeHoldId: holdId, status: ShowSeatStatus.HELD },
        data: { status: ShowSeatStatus.AVAILABLE, activeHoldId: null, holdExpiresAt: null },
      });
      await tx.hold.update({
        where: { id: holdId },
        data: { status: HoldStatus.EXPIRED, releasedAt: new Date() },
      });
    });
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

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
