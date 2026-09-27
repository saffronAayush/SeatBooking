import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { JwtUser } from '../common/types/jwt-user.type';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto, JwtUserResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a customer account' })
  @ApiCreatedResponse({ description: 'Customer registered successfully', type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Request validation failed', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Email is already registered', type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error',
    type: ErrorResponseDto,
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive an access/refresh token pair' })
  @ApiOkResponse({ description: 'Login successful', type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Request validation failed', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new token pair' })
  @ApiOkResponse({ description: 'Token pair rotated successfully', type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Request validation failed', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is invalid, expired, revoked, or reused',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse({ description: 'Refresh token revoked; response has no body' })
  @ApiBadRequestResponse({ description: 'Request validation failed', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is invalid or expired',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error',
    type: ErrorResponseDto,
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated access-token identity' })
  @ApiOkResponse({ description: 'Authenticated identity', type: JwtUserResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing or invalid',
    type: ErrorResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error',
    type: ErrorResponseDto,
  })
  me(@CurrentUser() user: JwtUser): JwtUser {
    return user;
  }
}
