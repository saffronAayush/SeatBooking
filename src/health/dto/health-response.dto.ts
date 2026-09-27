import { ApiProperty } from '@nestjs/swagger';

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T00:57:02.135Z' })
  timestamp: string;
}

export class ReadinessResponseDto extends LivenessResponseDto {
  @ApiProperty({ example: 'reachable' })
  database: string;
}
