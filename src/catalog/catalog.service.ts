import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { EventStatus, ShowStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { EventSearchDto } from './dto/event-search.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async searchEvents(query: EventSearchDto) {
    const showFilter: Prisma.ShowWhereInput = { status: ShowStatus.SCHEDULED };
    if (query.city) {
      showFilter.venue = {
        ...(showFilter.venue as Prisma.VenueWhereInput),
        city: { equals: query.city, mode: 'insensitive' },
      };
    }
    if (query.venue) {
      showFilter.venue = {
        ...(showFilter.venue as Prisma.VenueWhereInput),
        name: { contains: query.venue, mode: 'insensitive' },
      };
    }
    if (query.date) {
      const start = new Date(query.date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      showFilter.startsAt = { gte: start, lt: end };
    } else {
      showFilter.startsAt = { gte: new Date() };
    }

    const where: Prisma.EventWhereInput = {
      status: EventStatus.PUBLISHED,
      ...(query.name ? { title: { contains: query.name, mode: 'insensitive' } } : {}),
      ...(query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {}),
      shows: { some: showFilter },
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          organizer: { select: { id: true, displayName: true } },
          shows: {
            where: showFilter,
            orderBy: { startsAt: 'asc' },
            take: 10,
            include: {
              venue: { select: { id: true, name: true, city: true, timezone: true } },
              prices: { orderBy: { priceMinor: 'asc' } },
            },
          },
        },
      }),
      this.prisma.event.count({ where }),
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

  async getEvent(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: EventStatus.PUBLISHED },
      include: {
        organizer: { select: { id: true, displayName: true } },
        shows: {
          where: { status: ShowStatus.SCHEDULED, startsAt: { gte: new Date() } },
          orderBy: { startsAt: 'asc' },
          include: {
            venue: { select: { id: true, name: true, city: true, address: true, timezone: true } },
            prices: { orderBy: { priceMinor: 'asc' } },
            _count: { select: { showSeats: true } },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async getShowSeats(showId: string) {
    const show = await this.prisma.show.findFirst({
      where: {
        id: showId,
        status: ShowStatus.SCHEDULED,
        event: { status: EventStatus.PUBLISHED },
      },
      include: {
        event: { select: { id: true, title: true, category: true } },
        venue: { select: { id: true, name: true, city: true, timezone: true } },
        prices: { orderBy: { priceMinor: 'asc' } },
        showSeats: {
          orderBy: { createdAt: 'asc' },
          include: {
            seat: {
              select: {
                id: true,
                rowLabel: true,
                seatNumber: true,
                category: true,
                section: { select: { id: true, name: true, sortOrder: true } },
              },
            },
          },
        },
      },
    });
    if (!show) throw new NotFoundException('Show not found');
    return show;
  }
}
