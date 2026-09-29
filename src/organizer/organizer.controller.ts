import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '../generated/prisma/enums';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { JwtUser } from '../common/types/jwt-user.type';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateOrganizerProfileDto } from './dto/create-organizer-profile.dto';
import { CreateShowDto } from './dto/create-show.dto';
import { CreateVenueDto } from './dto/create-venue.dto';
import { OrganizerService } from './organizer.service';

@ApiTags('organizer')
@ApiBearerAuth()
@Roles(UserRole.ORGANIZER, UserRole.ADMIN)
@Controller('organizer')
export class OrganizerController {
  constructor(private readonly organizer: OrganizerService) {}

  @Post('profile')
  @ApiOperation({ summary: 'Create the current user organizer profile' })
  @ApiCreatedResponse({ description: 'Organizer profile created' })
  @ApiConflictResponse({ description: 'Profile already exists', type: ErrorResponseDto })
  createProfile(@CurrentUser() user: JwtUser, @Body() dto: CreateOrganizerProfileDto) {
    return this.organizer.createProfile(user.id, dto);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get the current user organizer profile' })
  @ApiOkResponse({ description: 'Organizer profile and catalog counts' })
  @ApiNotFoundResponse({ description: 'Profile does not exist', type: ErrorResponseDto })
  getProfile(@CurrentUser() user: JwtUser) {
    return this.organizer.getProfile(user.id);
  }

  @Post('venues')
  @ApiOperation({ summary: 'Create a venue and its complete physical seat layout' })
  @ApiCreatedResponse({ description: 'Venue and seat layout created' })
  createVenue(@CurrentUser() user: JwtUser, @Body() dto: CreateVenueDto) {
    return this.organizer.createVenue(user.id, dto);
  }

  @Post('events')
  @ApiOperation({ summary: 'Create an event owned by the current organizer' })
  @ApiCreatedResponse({ description: 'Event created' })
  createEvent(@CurrentUser() user: JwtUser, @Body() dto: CreateEventDto) {
    return this.organizer.createEvent(user.id, dto);
  }

  @Post('shows')
  @ApiOperation({
    summary: 'Schedule a show, configure category prices, and generate show-seat inventory',
  })
  @ApiCreatedResponse({ description: 'Show and immutable seat inventory created atomically' })
  createShow(@CurrentUser() user: JwtUser, @Body() dto: CreateShowDto) {
    return this.organizer.createShow(user.id, dto);
  }
}
