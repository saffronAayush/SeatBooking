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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateShowPriceDto {
  @ApiProperty({ format: 'uuid', description: 'Venue section this price applies to' })
  @IsUUID()
  sectionId: string;

  @ApiProperty({ example: 'GOLD' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  seatCategory: string;

  @ApiProperty({
    description: 'Price in the show currency minor unit (for example, paise for INR)',
    example: 125000,
  })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceMinor: number;
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

  @ApiProperty({ example: 'INR', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  currency: string;

  @ApiProperty({ type: [CreateShowPriceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CreateShowPriceDto)
  prices: CreateShowPriceDto[];
}
