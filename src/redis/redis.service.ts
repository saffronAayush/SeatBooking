import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);
  private unavailable = false;
  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 1000,
      commandTimeout: config.get<number>('REDIS_TIMEOUT_MS', 500),
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 5000),
    });
    this.client.on('error', () => {
      if (!this.unavailable)
        this.logger.warn('Redis unavailable; cache bypassed and protected requests rejected');
      this.unavailable = true;
    });
    this.client.on('ready', () => {
      this.unavailable = false;
    });
  }
  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
