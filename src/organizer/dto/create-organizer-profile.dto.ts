import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizerProfileDto {
  @ApiProperty({ example: 'Acme Live Experiences' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName: string;

  @ApiPropertyOptional({ example: 'Concerts and live entertainment across India.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
