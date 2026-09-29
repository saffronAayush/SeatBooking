import { Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../common/types/jwt-user.type';
import { BookingsService } from './bookings.service';
import { BookingQueryDto } from './dto/booking-query.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List bookings owned by the current customer' })
  list(@CurrentUser() user: JwtUser, @Query() query: BookingQueryDto) {
    return this.bookings.list(user.id, query);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Get one booking owned by the current customer' })
  get(@CurrentUser() user: JwtUser, @Param('bookingId', new ParseUUIDPipe()) id: string) {
    return this.bookings.get(user.id, id);
  }

  @Post(':bookingId/cancel')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Cancel a future booking, release its seats, and simulate a refund' })
  cancel(
    @CurrentUser() user: JwtUser,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.bookings.cancel(user.id, id, key);
  }
}
