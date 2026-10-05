import { Injectable, OnModuleInit, BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

@Injectable()
export class OperationsService implements OnModuleInit, BeforeApplicationShutdown {
  private server?: Server;
  private stopping = false;
  private dependencyReady: () => boolean = () => true;
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}
  setDependencyProbe(probe: () => boolean): void {
    this.dependencyReady = probe;
  }
  async onModuleInit(): Promise<void> {
    // Internal port: never published by Compose or routed through Nginx.
    this.server = createServer((req, res) => {
      void (async () => {
        if (req.method !== 'GET') {
          res.writeHead(405).end();
          return;
        }
        if (req.url === '/metrics') {
          res.setHeader('Content-Type', this.metrics.registry.contentType);
          res.end(await this.metrics.registry.metrics());
          return;
        }
        if (req.url === '/health/live') {
          res.writeHead(this.stopping ? 503 : 200).end();
          return;
        }
        if (req.url === '/health/ready') {
          if (this.stopping || !this.dependencyReady()) {
            res.writeHead(503).end();
            return;
          }
          await this.prisma.$queryRaw`SELECT 1`;
          res.writeHead(200).end();
          return;
        }
        res.writeHead(404).end();
      })().catch(() => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
    });
    this.server.requestTimeout = 15000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.get<number>('OPERATIONS_PORT', 9464), '0.0.0.0', resolve);
    });
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }
}
