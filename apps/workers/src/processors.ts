import { decideChannels, deliveryKey, QUEUES, REMINDER_JOB, type DismissPushJob, type EmailJob, type FireReminderJob, type WebhookJob } from '@remindora/notifications';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Deps } from './deps';
import { deliver, dismissElsewhere } from './delivery/deliver';
import { fireReminder, type Scheduler } from './reminders/fire';
import { effectivePrefs } from './prefs';
import { deliverWebhook } from './jobs/outbound';

export function createScheduler(connection: Redis): Scheduler & { reminders: Queue<FireReminderJob>; webhooks: Queue<WebhookJob>; close(): Promise<void> } {
  const reminders = new Queue<FireReminderJob>(QUEUES.reminders, { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
  const webhooks = new Queue<WebhookJob>(QUEUES.webhooks, { connection, defaultJobOptions: { attempts: 8, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
  return {
    reminders,
    webhooks,
    async schedule(reminderId, fireAt, attempt) {
      const jobId = deliveryKey(reminderId, fireAt, attempt).replace(/:/g, '_');
      await reminders.add(REMINDER_JOB, { reminderId, fireAt: fireAt.toISOString() }, { jobId, delay: Math.max(0, fireAt.getTime() - Date.now()) });
    },
    async webhook(job) {
      await webhooks.add(job.event, job);
    },
    async close() {
      await Promise.all([reminders.close(), webhooks.close()]);
    },
  };
}

export async function processReminder(d: Deps, scheduler: Scheduler, job: FireReminderJob) {
  return fireReminder(d, job, scheduler);
}

/** Pushes a notification created outside the reminder pipeline (mention, assignment, test). */
export async function processNotify(d: Deps, job: DismissPushJob) {
  const n = await d.prisma.notification.findUnique({ where: { id: job.notificationId }, include: { user: { include: { notificationPref: true } } } });
  if (!n || n.acknowledgedAt) return { skipped: true };
  const prefs = effectivePrefs(n.user.notificationPref, null, n.user.timezone);
  const decision = decideChannels(n.priority === 'NONE' ? 'MEDIUM' : n.priority, prefs, { emailEntitled: false });
  // In-app delivery already happened when the API created it.
  return deliver(d, n, decision.channels.filter((c) => c !== 'IN_APP'), { silent: decision.silent, link: `${d.env.WEB_URL}/app${n.taskId ? `/task?id=${n.taskId}` : '/notifications'}` });
}

export async function processDismiss(d: Deps, job: DismissPushJob) {
  return { sent: await dismissElsewhere(d, job.userId, job.notificationId, job.reminderId, job.exceptDeviceId) };
}

export async function processEmail(d: Deps, job: EmailJob) {
  await d.email.send(job);
  return { ok: true };
}

export async function processWebhook(d: Deps, job: WebhookJob) {
  await deliverWebhook(d, job);
  return { ok: true };
}
