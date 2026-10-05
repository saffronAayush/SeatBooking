import { trace } from '@opentelemetry/api';
import { RedisModule } from './redis/redis.module';
import { RateLimitGuard } from './redis/rate-limit.guard';
import { CatalogCacheInterceptor } from './redis/catalog-cache.interceptor';
import { ObservabilityModule } from './observability/observability.module';
import { MetricsService } from './observability/metrics.service';
import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
          customProps: () => ({ traceId: trace.getActiveSpan()?.spanContext().traceId }),
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
    RedisModule,
    ObservabilityModule,
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
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: CatalogCacheInterceptor },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly metrics: MetricsService) {}
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((request: Request, response: Response, next: NextFunction) => {
        const start = process.hrtime.bigint();
        response.once('finish', () => {
          const route = typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
          this.metrics.http.observe(
            { method: request.method, route, status: String(response.statusCode) },
            Number(process.hrtime.bigint() - start) / 1e9,
          );
        });
        const correlationId = String(response.getHeader('x-request-id') ?? randomUUID());
        requestContext.run({ correlationId }, next);
      })
      .forRoutes('{*path}');
  }
}
