import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { QueueService } from '../../queues/queue.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: QueueService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const [db, redis] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.client.ping()]);
    const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
    return { status: ok ? 'ok' : 'degraded', db: db.status === 'fulfilled', redis: redis.status === 'fulfilled', time: new Date().toISOString() };
  }

  /** Prometheus text format: queue depth and 24h notification delivery outcomes. */
  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics() {
    const since = new Date(Date.now() - 86_400_000);
    const [events, counts] = await Promise.all([
      this.prisma.notificationEvent.groupBy({ by: ['type', 'channel'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.queues.reminders.getJobCounts('waiting', 'delayed', 'active', 'failed'),
    ]);
    const lines = ['# HELP remindora_notification_events_24h Notification lifecycle events in the last 24h', '# TYPE remindora_notification_events_24h gauge'];
    for (const e of events) lines.push(`remindora_notification_events_24h{type="${e.type}",channel="${e.channel ?? 'none'}"} ${e._count._all}`);
    lines.push('# HELP remindora_reminder_queue_jobs Reminder queue jobs by state', '# TYPE remindora_reminder_queue_jobs gauge');
    for (const [state, n] of Object.entries(counts)) lines.push(`remindora_reminder_queue_jobs{state="${state}"} ${n}`);
    const mem = process.memoryUsage();
    lines.push('# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${mem.rss}`);
    return lines.join('\n') + '\n';
  }
}
