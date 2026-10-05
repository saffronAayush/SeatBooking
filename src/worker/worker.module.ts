import { ObservabilityModule } from '../observability/observability.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { envValidationSchema } from '../config/env.validation';
import { OutboxModule } from '../outbox/outbox.module';
import { PaymentsService } from '../payments/payments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReservationsService } from '../reservations/reservations.service';
import { NotificationWorkerService } from './notification-worker.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { RabbitMqService } from './rabbitmq.service';
import { ReconciliationService } from './reconciliation.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validationSchema: envValidationSchema }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          base: { service: 'seatforge-worker' },
        },
      }),
    }),
    PrismaModule,
    ObservabilityModule,
    OutboxModule,
  ],
  providers: [
    ReservationsService,
    PaymentsService,
    RabbitMqService,
    NotificationWorkerService,
    OutboxPublisherService,
    ReconciliationService,
    WorkerService,
  ],
})
export class WorkerModule {}
