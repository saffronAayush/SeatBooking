import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsService } from './operations.service';
import { MetricsService } from './metrics.service';
import { shutdownTelemetry } from './telemetry';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [MetricsService, OperationsService],
  exports: [MetricsService, OperationsService],
})
export class ObservabilityModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
