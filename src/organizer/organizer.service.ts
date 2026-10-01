import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { EventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateOrganizerProfileDto } from './dto/create-organizer-profile.dto';
import { CreateShowDto } from './dto/create-show.dto';
import { CreateVenueDto } from './dto/create-venue.dto';

@Injectable()
export class OrganizerService {
  constructor(private readonly prisma: PrismaService) {}

  async createProfile(userId: string, dto: CreateOrganizerProfileDto) {
    try {
      return await this.prisma.organizer.create({
        data: {
          userId,
          displayName: dto.displayName.trim(),
          description: dto.description?.trim(),
        },
      });
    } catch (error: unknown) {
      this.rethrowUniqueConflict(error, 'This account already has an organizer profile');
    }
  }

  async getProfile(userId: string) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      include: { _count: { select: { venues: true, events: true } } },
    });
    if (!organizer) throw new NotFoundException('Organizer profile not found');
    return organizer;
  }

  async createVenue(userId: string, dto: CreateVenueDto) {
    const organizer = await this.requireOrganizer(userId);
    this.validateVenueLayout(dto);

    try {
      return await this.prisma.venue.create({
        data: {
          organizerId: organizer.id,
          name: dto.name.trim(),
          city: dto.city.trim(),
          address: dto.address.trim(),
          timezone: dto.timezone?.trim() ?? 'Asia/Kolkata',
          sections: {
            create: dto.sections.map((section, sectionIndex) => ({
              name: section.name.trim(),
              sortOrder: section.sortOrder ?? sectionIndex,
              seats: {
                create: section.seats.map((seat) => ({
                  rowLabel: seat.rowLabel.trim(),
                  seatNumber: seat.seatNumber.trim(),
                  category: seat.category.trim().toUpperCase(),
                })),
              },
            })),
          },
        },
        include: {
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: { seats: { orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }] } },
          },
        },
      });
    } catch (error: unknown) {
      this.rethrowUniqueConflict(error, 'A venue or seat in this layout already exists');
    }
  }

  async createEvent(userId: string, dto: CreateEventDto) {
    const organizer = await this.requireOrganizer(userId);
    return this.prisma.event.create({
      data: {
        organizerId: organizer.id,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        category: dto.category.trim().toUpperCase(),
        status: dto.status ?? EventStatus.DRAFT,
      },
    });
  }

  async createShow(userId: string, dto: CreateShowDto) {
    const organizer = await this.requireOrganizer(userId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');

    const [event, venue] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: dto.eventId } }),
      this.prisma.venue.findUnique({
        where: { id: dto.venueId },
        include: { sections: { include: { seats: true } } },
      }),
    ]);

    if (!event || event.organizerId !== organizer.id) {
      throw new NotFoundException('Event not found');
    }
    if (!venue || venue.organizerId !== organizer.id) {
      throw new NotFoundException('Venue not found');
    }

    const seats = venue.sections.flatMap((section) => section.seats);
    if (seats.length === 0) throw new BadRequestException('Venue has no seats');

    const priceKey = (sectionId: string, seatCategory: string) => `${sectionId}:${seatCategory}`;
    const sectionsById = new Map(venue.sections.map((section) => [section.id, section]));
    const prices = new Map<
      string,
      { sectionId: string; seatCategory: string; priceMinor: number }
    >();

    for (const price of dto.prices) {
      const category = price.seatCategory.trim().toUpperCase();
      const section = sectionsById.get(price.sectionId);
      if (!section) {
        throw new BadRequestException(
          `Section ${price.sectionId} does not belong to the selected venue`,
        );
      }
      if (!category) throw new BadRequestException('Seat category must not be blank');

      const key = priceKey(section.id, category);
      if (prices.has(key)) {
        throw new BadRequestException(
          `Duplicate price for section ${section.name} and seat category ${category}`,
        );
      }
      prices.set(key, {
        sectionId: section.id,
        seatCategory: category,
        priceMinor: price.priceMinor,
      });
    }

    const requiredPrices = new Map<string, string>();
    for (const section of venue.sections) {
      for (const seat of section.seats) {
        const category = seat.category.trim().toUpperCase();
        requiredPrices.set(priceKey(section.id, category), `${section.name} / ${category}`);
      }
    }

    const missing = [...requiredPrices]
      .filter(([key]) => !prices.has(key))
      .map(([, label]) => label);
    const unused = [...prices]
      .filter(([key]) => !requiredPrices.has(key))
      .map(([, price]) => {
        const section = sectionsById.get(price.sectionId)!;
        return `${section.name} / ${price.seatCategory}`;
      });
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing prices for section/category pairs: ${missing.join(', ')}`,
      );
    }
    if (unused.length > 0) {
      throw new BadRequestException(
        `Prices supplied for unused section/category pairs: ${unused.join(', ')}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const show = await transaction.show.create({
          data: {
            eventId: event.id,
            venueId: venue.id,
            startsAt,
            endsAt,
            currency: dto.currency.toUpperCase(),
            prices: {
              create: [...prices.values()],
            },
          },
          include: {
            prices: {
              orderBy: [{ sectionId: 'asc' }, { seatCategory: 'asc' }],
              include: { section: { select: { id: true, name: true, sortOrder: true } } },
            },
          },
        });

        const showPriceIds = new Map(
          show.prices.map((price) => [priceKey(price.sectionId, price.seatCategory), price.id]),
        );

        await transaction.showSeat.createMany({
          data: seats.map((seat) => ({
            showId: show.id,
            seatId: seat.id,
            showPriceId: showPriceIds.get(
              priceKey(seat.sectionId, seat.category.trim().toUpperCase()),
            )!,
          })),
        });

        return { ...show, inventoryCount: seats.length };
      });
    } catch (error: unknown) {
      this.rethrowUniqueConflict(
        error,
        'A show for this event, venue, and start time already exists',
      );
    }
  }

  private async requireOrganizer(userId: string) {
    const organizer = await this.prisma.organizer.findUnique({ where: { userId } });
    if (!organizer) {
      throw new NotFoundException('Create an organizer profile before managing catalog data');
    }
    return organizer;
  }

  private validateVenueLayout(dto: CreateVenueDto): void {
    if (dto.sections.reduce((total, section) => total + section.seats.length, 0) > 10000) {
      throw new BadRequestException('A venue may contain at most 10,000 seats');
    }

    const sectionNames = new Set<string>();
    for (const section of dto.sections) {
      const sectionName = section.name.trim().toLowerCase();
      if (sectionNames.has(sectionName)) {
        throw new BadRequestException(`Duplicate section name: ${section.name}`);
      }
      sectionNames.add(sectionName);

      const seatLabels = new Set<string>();
      for (const seat of section.seats) {
        const label = `${seat.rowLabel.trim().toLowerCase()}::${seat.seatNumber.trim().toLowerCase()}`;
        if (seatLabels.has(label)) {
          throw new BadRequestException(
            `Duplicate seat ${seat.rowLabel}-${seat.seatNumber} in section ${section.name}`,
          );
        }
        seatLabels.add(label);
      }
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: dto.timezone ?? 'Asia/Kolkata' }).format();
    } catch {
      throw new BadRequestException('timezone must be a valid IANA time zone');
    }
  }

  private rethrowUniqueConflict(error: unknown, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw error;
  }
}
