import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Request } from 'express';
import { Observable, from, lastValueFrom } from 'rxjs';
import { MetricsService } from '../observability/metrics.service';
import { RedisService } from './redis.service';

@Injectable()
export class CatalogCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const controller = context.getClass().name;
    const cacheable =
      controller === 'CatalogController' && context.getHandler().name !== 'getShowSeats';
    const invalidates = controller === 'OrganizerController' && request.method !== 'GET';
    if (!cacheable && !invalidates) return next.handle();
    return from(this.execute(request, next, cacheable));
  }
  private async execute(request: Request, next: CallHandler, cacheable: boolean): Promise<unknown> {
    let key: string | undefined;
    if (cacheable) {
      try {
        const generation =
          (await this.redis.client.get('seatforge:catalog:generation')) ?? 'initial';
        key = `seatforge:catalog:${generation}:${createHash('sha256').update(request.originalUrl).digest('hex')}`;
        const cached = await this.redis.client.get(key);
        if (cached) {
          this.metrics.cache.inc({ outcome: 'hit' });
          return JSON.parse(cached);
        }
        this.metrics.cache.inc({ outcome: 'miss' });
      } catch {
        key = undefined;
        this.metrics.cache.inc({ outcome: 'error' });
      }
    }
    // Only successful handler results are cached. Generation keys isolate in-flight stale reads.
    const result: unknown = await lastValueFrom(next.handle());
    try {
      if (cacheable && key)
        await this.redis.client.set(
          key,
          JSON.stringify(result),
          'EX',
          this.config.getOrThrow<number>('CATALOG_CACHE_TTL_SECONDS'),
        );
      if (!cacheable) await this.redis.client.set('seatforge:catalog:generation', randomUUID());
    } catch {
      this.metrics.cache.inc({ outcome: 'error' });
    }
    return result;
  }
}
