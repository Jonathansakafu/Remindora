import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type ServerEnv } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: ServerEnv) {
    this.client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /** Separate connection for pub/sub and BullMQ, which take over the connection. */
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
