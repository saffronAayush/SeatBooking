import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token returned by login or token rotation' })
  @IsJWT()
  refreshToken: string;
}
