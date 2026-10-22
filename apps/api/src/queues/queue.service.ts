import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { deliveryKey, QUEUES, REMINDER_JOB, type DismissPushJob, type EmailJob, type FireReminderJob, type WebhookJob } from '@remindora/notifications';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ENV, type ServerEnv } from '../config';

/** BullMQ producers. Workers (apps/workers) consume these queues. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  readonly reminders: Queue<FireReminderJob>;
  readonly email: Queue<EmailJob>;
  readonly push: Queue<DismissPushJob>;
  readonly webhooks: Queue<WebhookJob>;

  constructor(@Inject(ENV) env: ServerEnv) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const defaults = { attempts: 5, backoff: { type: 'exponential' as const, delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 };
    this.reminders = new Queue(QUEUES.reminders, { connection: this.connection, defaultJobOptions: { ...defaults, attempts: 3 } });
    this.email = new Queue(QUEUES.email, { connection: this.connection, defaultJobOptions: defaults });
    this.push = new Queue(QUEUES.push, { connection: this.connection, defaultJobOptions: defaults });
    this.webhooks = new Queue(QUEUES.webhooks, { connection: this.connection, defaultJobOptions: { ...defaults, attempts: 8 } });
  }

  /**
   * Schedules a reminder fire job. The jobId embeds reminder+fireAt+attempt so the
   * same occurrence is never queued twice; the DB sweeper re-enqueues if Redis loses it.
   */
  async scheduleReminder(reminderId: string, fireAt: Date, attempt: number) {
    const jobId = deliveryKey(reminderId, fireAt, attempt).replace(/:/g, '_');
    await this.reminders.add(REMINDER_JOB, { reminderId, fireAt: fireAt.toISOString() }, { jobId, delay: Math.max(0, fireAt.getTime() - Date.now()) });
  }

  async sendEmail(job: EmailJob) {
    await this.email.add(job.category, job);
  }

  async dismissOnOtherDevices(job: DismissPushJob) {
    await this.push.add('dismiss', job);
  }

  async webhook(job: WebhookJob) {
    await this.webhooks.add(job.event, job);
  }

  async onModuleDestroy() {
    await Promise.all([this.reminders.close(), this.email.close(), this.push.close(), this.webhooks.close()]);
    await this.connection.quit().catch(() => undefined);
  }
}
