import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { RedisService } from './redis.service';
import { MetricsService } from '../observability/metrics.service';

const INCREMENT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const controller = context.getClass().name;
    const policy =
      controller === 'AuthController' && req.method === 'POST'
        ? 'auth'
        : controller === 'ReservationsController' && req.method === 'POST'
          ? 'holds'
          : controller === 'CatalogController'
            ? context.getHandler().name === 'getShowSeats'
              ? 'seats'
              : 'catalog'
            : undefined;
    if (!policy) return true;
    const identity = createHash('sha256')
      .update(
        policy === 'holds' && req.user
          ? req.user.id
          : (req.ip ?? req.socket.remoteAddress ?? 'unknown'),
      )
      .digest('hex');
    const maximum = this.config.getOrThrow<number>(`RATE_LIMIT_${policy.toUpperCase()}`);
    let result: [number, number];
    try {
      result = (await this.redis.client.eval(
        INCREMENT,
        1,
        `seatforge:rate:${policy}:${identity}`,
        60000,
      )) as [number, number];
    } catch {
      this.metrics.limits.inc({ policy, outcome: 'unavailable' });
      if (policy === 'catalog' || policy === 'seats') return true;
      res.setHeader('Retry-After', '5');
      throw new ServiceUnavailableException('Rate limiting temporarily unavailable; retry shortly');
    }
    res.setHeader('X-RateLimit-Limit', maximum);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maximum - result[0]));
    if (result[0] > maximum) {
      this.metrics.limits.inc({ policy, outcome: 'rejected' });
      res.setHeader('Retry-After', Math.max(1, Math.ceil(result[1] / 1000)));
      throw new HttpException('Too many requests', 429);
    }
    this.metrics.limits.inc({ policy, outcome: 'allowed' });
    return true;
  }
}
