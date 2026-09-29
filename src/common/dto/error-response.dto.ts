import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Invalid email or password' },
      {
        type: 'array',
        items: { type: 'string' },
        example: [
          'email must be an email',
          'password must be longer than or equal to 10 characters',
        ],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({ example: '/api/v1/auth/login' })
  path: string;

  @ApiProperty({
    description: 'ID used to correlate this response with server logs',
    example: 'd9dcfdbe-069d-4584-b49f-4bd20ec36499',
  })
  requestId: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-27T00:57:02.135Z' })
  timestamp: string;
}
