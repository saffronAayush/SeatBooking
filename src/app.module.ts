import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { CatalogModule } from './catalog/catalog.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { OrganizerModule } from './organizer/organizer.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsModule } from './reservations/reservations.module';
import { OutboxModule } from './outbox/outbox.module';
import { requestContext } from './outbox/request-context';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    // reads env vars
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          genReqId: (request, response) => {
            const header = request.headers['x-request-id'];
            const requestId =
              typeof header === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(header)
                ? header
                : randomUUID();
            response.setHeader('x-request-id', requestId);
            return requestId;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'password',
              'token',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    PrismaModule,
    OutboxModule,
    NotificationsModule,
    AuthModule,
    CatalogModule,
    OrganizerModule,
    ReservationsModule,
    PaymentsModule,
    BookingsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((request: Request, response: Response, next: NextFunction) => {
        const correlationId = String(response.getHeader('x-request-id') ?? randomUUID());
        requestContext.run({ correlationId }, next);
      })
      .forRoutes('{*path}');
  }
}
