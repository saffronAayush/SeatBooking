import { Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../common/types/jwt-user.type';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('holds')
@ApiBearerAuth()
@Controller('holds')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @ApiOperation({ summary: 'Atomically hold available show seats' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @CurrentUser() user: JwtUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateHoldDto,
  ) {
    return this.reservations.create(user.id, key, dto);
  }

  @Get(':holdId')
  @ApiOperation({ summary: 'Get one hold owned by the current customer' })
  get(@CurrentUser() user: JwtUser, @Param('holdId', new ParseUUIDPipe()) holdId: string) {
    return this.reservations.get(user.id, holdId);
  }

  @Delete(':holdId')
  @ApiOperation({ summary: 'Release an active hold and its seats' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  release(
    @CurrentUser() user: JwtUser,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.reservations.release(user.id, holdId, key);
  }
}
