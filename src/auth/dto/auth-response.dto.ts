import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums';

export class SafeUserResponseDto {
  @ApiProperty({ format: 'uuid', example: 'aa88bb55-fbc5-4f4c-a24f-f42e1bcb3219' })
  id: string;

  @ApiProperty({ format: 'email', example: 'customer@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, isArray: true, example: [UserRole.CUSTOMER] })
  roles: UserRole[];

  @ApiProperty({ format: 'date-time', example: '2026-09-27T00:57:02.135Z' })
  createdAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({ type: SafeUserResponseDto })
  user: SafeUserResponseDto;

  @ApiProperty({ description: 'Short-lived JWT used to authorize API requests' })
  accessToken: string;

  @ApiProperty({ description: 'Rotating JWT used to obtain a new token pair' })
  refreshToken: string;

  @ApiProperty({ example: 900 })
  accessTokenExpiresInSeconds: number;
}

export class JwtUserResponseDto {
  @ApiProperty({ format: 'uuid', example: 'aa88bb55-fbc5-4f4c-a24f-f42e1bcb3219' })
  id: string;

  @ApiProperty({ format: 'email', example: 'customer@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, isArray: true, example: [UserRole.CUSTOMER] })
  roles: UserRole[];
}
