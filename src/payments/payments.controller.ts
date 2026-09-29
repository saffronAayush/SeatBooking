import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
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

  @Public()
  @Post('webhooks/simulator')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'X-Simulator-Signature', required: true })
  @ApiOperation({ summary: 'Receive a signed callback from the payment simulator' })
  webhook(
    @Headers('x-simulator-signature') signature: string | undefined,
    @Body() dto: PaymentCallbackDto,
  ) {
    this.payments.verifySimulatorSignature(signature, dto);
    return this.payments.processCallback(dto);
  }
}
