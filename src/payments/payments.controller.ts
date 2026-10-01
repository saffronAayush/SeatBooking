import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../common/types/jwt-user.type';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentCallbackDto } from './dto/payment-callback.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a payment intent for an active hold' })
  createIntent(
    @CurrentUser() user: JwtUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.payments.createIntent(user.id, key, dto);
  }

  @Post('simulator/callback')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulate a payment callback for an intent owned by the customer' })
  simulate(@CurrentUser() user: JwtUser, @Body() dto: PaymentCallbackDto) {
    return this.payments.processCallback(dto, user.id);
  }
}
