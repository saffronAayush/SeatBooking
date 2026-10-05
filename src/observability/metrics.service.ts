import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly http = new Histogram({
    name: 'seatforge_http_duration_seconds',
    help: 'HTTP latency including rejected requests',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly cache = new Counter({
    name: 'seatforge_cache_total',
    help: 'Catalog cache outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly limits = new Counter({
    name: 'seatforge_rate_limit_total',
    help: 'Distributed limiter outcomes',
    labelNames: ['policy', 'outcome'],
    registers: [this.registry],
  });
  readonly jobs = new Histogram({
    name: 'seatforge_worker_job_seconds',
    help: 'Worker sweep duration',
    labelNames: ['task', 'outcome'],
    registers: [this.registry],
  });
  readonly deliveries = new Counter({
    name: 'seatforge_delivery_total',
    help: 'Notification delivery outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly published = new Counter({
    name: 'seatforge_outbox_publish_total',
    help: 'Outbox publishing outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  brokerReady: () => boolean = () => false;
  readonly broker = new Gauge({
    name: 'seatforge_worker_broker_ready',
    help: 'Worker has an active RabbitMQ consumer',
    collect: () => {
      this.broker.set(this.brokerReady() ? 1 : 0);
    },
    registers: [this.registry],
  });
  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'seatforge_' });
  }
}
