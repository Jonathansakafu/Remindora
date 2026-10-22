import { CALENDAR_REFRESH_JOB, DIGEST_JOB, HABIT_JOB, QUEUES, SWEEP_JOB, type DismissPushJob, type EmailJob, type FireReminderJob, type WebhookJob } from '@remindora/notifications';
import * as Sentry from '@sentry/node';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { createDeps } from './deps';
import { runDigests } from './jobs/digest';
import { runHabitReminders } from './jobs/habits';
import { runMaintenance } from './jobs/maintenance';
import { refreshCalendars } from './jobs/outbound';
import { createScheduler, processDismiss, processEmail, processNotify, processReminder, processWebhook } from './processors';
import { sweepDueReminders } from './reminders/fire';

async function main() {
  const d = createDeps();
  if (d.env.SENTRY_DSN) Sentry.init({ dsn: d.env.SENTRY_DSN, environment: d.env.NODE_ENV });
  const connection = new Redis(d.env.REDIS_URL, { maxRetriesPerRequest: null });
  const scheduler = createScheduler(connection);
  const maintenance = new Queue(QUEUES.maintenance, { connection });

  // Repeatable jobs (deduplicated by BullMQ across replicas).
  await maintenance.upsertJobScheduler(SWEEP_JOB, { every: 60_000 }, { name: SWEEP_JOB });
  await maintenance.upsertJobScheduler(DIGEST_JOB, { every: 5 * 60_000 }, { name: DIGEST_JOB });
  await maintenance.upsertJobScheduler(HABIT_JOB, { every: 5 * 60_000 }, { name: HABIT_JOB });
  await maintenance.upsertJobScheduler(CALENDAR_REFRESH_JOB, { every: 30 * 60_000 }, { name: CALENDAR_REFRESH_JOB });
  await maintenance.upsertJobScheduler('housekeeping', { every: 60 * 60_000 }, { name: 'housekeeping' });

  const opts = { connection, concurrency: 10 };
  const track = (name: string) => (job: Job | undefined, err: Error) => {
    d.log.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed');
    Sentry.captureException(err);
  };

  const workers = [
    new Worker<FireReminderJob>(QUEUES.reminders, async (job) => processReminder(d, scheduler, job.data), { ...opts, concurrency: 25 }),
    new Worker<DismissPushJob>(QUEUES.push, async (job) => (job.name === 'dismiss' ? processDismiss(d, job.data) : processNotify(d, job.data)), opts),
    new Worker<EmailJob>(QUEUES.email, async (job) => processEmail(d, job.data), opts),
    new Worker<WebhookJob>(QUEUES.webhooks, async (job) => processWebhook(d, job.data), opts),
    new Worker(
      QUEUES.maintenance,
      async (job) => {
        switch (job.name) {
          case SWEEP_JOB:
            return { queued: await sweepDueReminders(d, scheduler) };
          case DIGEST_JOB:
            return { sent: await runDigests(d, new Date(), (userId, heading, lines) => scheduler.webhook!({ userId, event: 'digest', payload: { heading, lines } })) };
          case HABIT_JOB:
            return { sent: await runHabitReminders(d) };
          case CALENDAR_REFRESH_JOB:
            return refreshCalendars(d);
          default:
            return runMaintenance(d);
        }
      },
      { connection, concurrency: 1 },
    ),
  ];
  for (const w of workers) w.on('failed', track(w.name));
  d.log.info('Remindora workers running: reminders, push, email, webhooks, maintenance');

  const shutdown = async () => {
    d.log.info('shutting down workers');
    await Promise.all(workers.map((w) => w.close()));
    await scheduler.close();
    await maintenance.close();
    await d.prisma.$disconnect();
    connection.disconnect();
    d.redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
