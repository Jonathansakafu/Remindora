import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from './errors';
import { RedisService } from './redis.service';
import { clientIp, type AuthedRequest } from './request';

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowSeconds: number;
  /** What the bucket is keyed by. */
  by?: 'ip' | 'user';
  name?: string;
}

const RATE_LIMIT = 'rateLimit';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT, rules);

/** Fixed-window counters in Redis, shared across API instances. */
@Injectable()
export class RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const [[, count]] = (await this.redis.client.multi().incr(bucket).expire(bucket, windowSeconds + 1).exec()) as [[null, number]];
    if (count > limit) {
      const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
      throw Errors.tooMany(retryAfter);
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMIT, [ctx.getHandler(), ctx.getClass()]) ?? [
      // Default: generous per-IP ceiling for every route.
      { limit: 600, windowSeconds: 60, by: 'ip', name: 'global' },
    ];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const route = rules[0]?.name ?? `${ctx.getClass().name}.${ctx.getHandler().name}`;
    for (const rule of rules) {
      const who = rule.by === 'user' && req.auth ? `u:${req.auth.userId}` : `ip:${clientIp(req)}`;
      await this.limiter.hit(`${rule.name ?? route}:${who}`, rule.limit, rule.windowSeconds);
    }
    return true;
  }
}
