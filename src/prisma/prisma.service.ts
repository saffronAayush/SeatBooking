import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      // Background recovery must return to its retry loop when PostgreSQL is down
      // or contended, instead of keeping the worker (and shutdown) blocked forever.
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      lock_timeout: 3000,
    });

    super({ adapter });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
