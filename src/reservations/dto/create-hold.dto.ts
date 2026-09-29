import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class CreateHoldDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  showId: string;

  @ApiProperty({ type: [String], description: 'Show-seat IDs, not physical seat IDs' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  showSeatIds: string[];
}
