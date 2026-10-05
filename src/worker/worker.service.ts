import { MetricsService } from '../observability/metrics.service';
import { OperationsService } from '../observability/operations.service';
import { BeforeApplicationShutdown, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReservationsService } from '../reservations/reservations.service';
import { NotificationWorkerService } from './notification-worker.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { RabbitMqService } from './rabbitmq.service';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
export class WorkerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private stopping = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly operations: OperationsService,
    private readonly rabbit: RabbitMqService,
    private readonly publisher: OutboxPublisherService,
    private readonly notifications: NotificationWorkerService,
    private readonly reservations: ReservationsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  onModuleInit(): void {
    this.operations.setDependencyProbe(() => !this.stopping && this.rabbit.isReady());
    this.metrics.brokerReady = () => this.rabbit.isReady();
    this.startLoop('consumer', this.config.get<number>('WORKER_RECONNECT_MS', 5000), () =>
      this.rabbit.ensureConsumer((message) => this.notifications.handle(message)),
    );
    this.startLoop('outbox', this.config.get<number>('OUTBOX_POLL_INTERVAL_MS', 1000), () =>
      this.publisher.publishBatch(() => this.stopping),
    );
    this.startLoop('expiry', this.config.get<number>('HOLD_EXPIRY_INTERVAL_MS', 5000), async () => {
      const count = await this.reservations.expireDueHolds(() => this.stopping);
      if (count > 0) this.logger.log({ count }, 'Expired holds released');
    });
    const interval = this.config.get<number>('RECONCILIATION_INTERVAL_MS', 30000);
    this.startLoop('payments', interval, () =>
      this.reconciliation.reconcilePayments(() => this.stopping),
    );
    this.startLoop('missing-events', interval, () =>
      this.reconciliation.repairMissingEvents(() => this.stopping),
    );
  }

  private startLoop(name: string, interval: number, action: () => Promise<void>): void {
    const schedule = (delay: number) => {
      if (this.stopping) return;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        const end = this.metrics.jobs.startTimer({ task: name });
        let outcome = 'success';
        const task = action()
          .catch(() => {
            outcome = 'error';
            this.logger.warn({ job: name }, 'Worker job deferred until the next sweep');
          })
          .finally(() => {
            end({ outcome });
            this.active.delete(task);
            schedule(interval);
          });
        this.active.add(task);
      }, delay);
      this.timers.add(timer);
    };
    // Schedule after completion, so slow jobs never overlap in the same process.
    schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearTimeout(timer);
    await Promise.allSettled([...this.active]);
    await this.rabbit.stopConsumer();
    await this.rabbit.close();
  }
}
