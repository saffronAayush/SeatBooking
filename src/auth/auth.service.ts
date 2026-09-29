import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { randomUUID } from 'node:crypto';
import { JwtPayload } from '../common/types/jwt-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';

export interface SafeUser {
  id: string;
  email: string;
  roles: UserRole[];
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}

export interface AuthResponse extends TokenPair {
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await this.passwords.hash(dto.password),
          roles: [dto.role ?? UserRole.CUSTOMER],
        },
      });
      return this.createAuthResponse(user);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (!user || !(await this.passwords.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload.jti || !payload.familyId) throw new UnauthorizedException('Invalid refresh token');

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (!storedToken) throw new UnauthorizedException('Invalid refresh token');

    if (storedToken.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const validHash = await this.passwords.compare(refreshToken, storedToken.tokenHash);
    if (!validHash || storedToken.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.createAuthResponse(storedToken.user, storedToken.familyId);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload.jti) return;

    await this.prisma.refreshToken.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createAuthResponse(
    user: User,
    familyId: string = randomUUID(),
  ): Promise<AuthResponse> {
    const tokens = await this.issueTokens(user, familyId);
    return {
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles,
        createdAt: user.createdAt,
      },
      ...tokens,
    };
  }

  private async issueTokens(user: User, familyId: string): Promise<TokenPair> {
    const accessTokenExpiresInSeconds = this.config.get<number>('JWT_ACCESS_TTL_SECONDS', 900);
    const refreshTokenTtlDays = this.config.get<number>('JWT_REFRESH_TTL_DAYS', 30);
    const refreshTokenId = randomUUID();
    const basePayload: JwtPayload = { sub: user.id, email: user.email, roles: user.roles };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(basePayload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTokenExpiresInSeconds,
      }),
      this.jwt.signAsync(
        { ...basePayload, jti: refreshTokenId, familyId },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshTokenTtlDays * 24 * 60 * 60,
        },
      ),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        id: refreshTokenId,
        familyId,
        userId: user.id,
        tokenHash: await this.passwords.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken, accessTokenExpiresInSeconds };
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
