/** BullMQ queue names and job payloads shared by the API (producer) and workers (consumers). */

export const QUEUES = {
  reminders: 'reminders',
  email: 'email',
  push: 'push',
  webhooks: 'webhooks',
  maintenance: 'maintenance',
} as const;

export interface FireReminderJob {
  reminderId: string;
  /** ISO fire time the job was scheduled for; stale jobs (reminder rescheduled since) are skipped. */
  fireAt: string;
}

export interface EmailJob {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for metrics and log lines — never log the body (may contain codes). */
  category: 'auth' | 'reminder' | 'digest' | 'invite' | 'report' | 'system';
}

/** Tells a user's other devices to clear a notification that was resolved elsewhere. */
export interface DismissPushJob {
  userId: string;
  notificationId: string;
  reminderId: string | null;
  exceptDeviceId: string | null;
}

export interface WebhookJob {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
}

export const REMINDER_JOB = 'fire';
export const SWEEP_JOB = 'sweep';
export const DIGEST_JOB = 'digest';
export const HABIT_JOB = 'habit-reminders';
export const CALENDAR_REFRESH_JOB = 'calendar-refresh';
