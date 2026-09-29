import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaymentEventOutcome } from '../../generated/prisma/client';

export class PaymentCallbackDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentIntentId: string;

  @ApiProperty({ example: 'sim_evt_001' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  providerEventId: string;

  @ApiProperty({ enum: PaymentEventOutcome })
  @IsEnum(PaymentEventOutcome)
  outcome: PaymentEventOutcome;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  occurredAt?: string;
}
