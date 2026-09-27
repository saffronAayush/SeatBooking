import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateShowPriceDto {
  @ApiProperty({ example: 'GOLD' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  seatCategory: string;

  @ApiProperty({ description: 'Price in minor currency units (for INR, paise)', example: 125000 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceMinor: number;

  @ApiProperty({ example: 'INR', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class CreateShowDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  venueId: string;

  @ApiProperty({ format: 'date-time', example: '2026-12-01T19:00:00.000Z' })
  @IsDateString({ strict: true })
  startsAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-12-01T22:00:00.000Z' })
  @IsDateString({ strict: true })
  endsAt: string;

  @ApiProperty({ type: [CreateShowPriceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateShowPriceDto)
  prices: CreateShowPriceDto[];
}
