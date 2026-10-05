import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../common/types/jwt-user.type';
import { BookingQueryDto } from '../bookings/dto/booking-query.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications owned by the current customer' })
  list(@CurrentUser() user: JwtUser, @Query() query: BookingQueryDto) {
    return this.notifications.list(user.id, query);
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Mark a notification as read (idempotent)' })
  read(@CurrentUser() user: JwtUser, @Param('notificationId', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
