import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10, example: 'strong-password' })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    enum: [UserRole.CUSTOMER, UserRole.ORGANIZER],
    default: UserRole.CUSTOMER,
    required: false,
    description: 'Public registration cannot create administrator accounts',
  })
  @IsOptional()
  @IsIn([UserRole.CUSTOMER, UserRole.ORGANIZER])
  role?: UserRole;
}
