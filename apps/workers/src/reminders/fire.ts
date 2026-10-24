import { applyDeliveryWindow, decideChannels, deliveryKey, nextRealertAt, type FireReminderJob } from '@remindora/notifications';
import { realtimeRooms } from '@remindora/types';
import { DateTime } from 'luxon';
import type { Deps } from '../deps';
import { deliver, dismissElsewhere } from '../delivery/deliver';
import { entitlementsFor } from '../entitlements';
import { effectivePrefs } from '../prefs';

const LOCK_MS = 60_000;
const EARLY_TOLERANCE_MS = 5_000;

export type FireOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'deferred'; until: Date }
  | { status: 'fired'; notificationId: string | null; channels: string[]; nextFireAt: Date | null };

export interface Scheduler {
  schedule(reminderId: string, fireAt: Date, attempt: number): Promise<void>;
  webhook?(job: { userId: string; event: string; payload: Record<string, unknown> }): Promise<void>;
}

/**
 * Fires one reminder occurrence/attempt. Safe to call concurrently and repeatedly:
 * a row lock (lockedUntil) admits one worker, stale jobs are ignored because the
 * DB's nextFireAt is authoritative, and the notification dedupeKey makes the
 * notification itself idempotent across retries and devices.
 */
/** "In 1 day · " for early reminders (offset before the due time); nothing for on-time ones. */
export function earlyLabel(offsetMinutes: number | null | undefined) {
  const m = offsetMinutes ?? 0;
  if (m <= 0) return '';
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const text = m % 1440 === 0 ? fmt(m / 1440, 'day') : m % 60 === 0 ? fmt(m / 60, 'hour') : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  return `In ${text} · `;
}

export async function fireReminder(d: Deps, job: FireReminderJob, scheduler: Scheduler, now = new Date()): Promise<FireOutcome> {
  const claimed = await d.prisma.reminder.updateMany({
    where: {
      id: job.reminderId,
      state: { in: ['ACTIVE', 'SNOOZED'] },
      nextFireAt: { lte: new Date(now.getTime() + EARLY_TOLERANCE_MS) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!claimed.count) return { status: 'skipped', reason: 'not_due_or_locked' };

  const release = (data: Record<string, unknown> = {}) => d.prisma.reminder.update({ where: { id: job.reminderId }, data: { lockedUntil: null, ...data } });

  try {
    const r = await d.prisma.reminder.findUniqueOrThrow({
      where: { id: job.reminderId },
      include: { task: { include: { project: { select: { name: true } } } }, subtask: true, user: { include: { notificationPref: true } } },
    });
    const task = r.task;
    if (task.completedAt || task.deletedAt || task.archived) {
      await release({ state: task.completedAt ? 'DONE' : 'STOPPED', nextFireAt: null });
      return { status: 'skipped', reason: 'task_closed' };
    }
    if (r.subtask?.done) {
      await release({ state: 'DONE', nextFireAt: null });
      return { status: 'skipped', reason: 'checklist_item_done' };
    }

    const override = await d.prisma.projectNotificationOverride.findUnique({ where: { userId_projectId: { userId: r.userId, projectId: task.projectId } } });
    const prefs = effectivePrefs(r.user.notificationPref, override, r.user.timezone);

    // Preferences may have changed since scheduling (quiet hours, weekends): re-check the window.
    const windowAt = applyDeliveryWindow(now, prefs, task.priority);
    if (windowAt.getTime() - now.getTime() > 60_000) {
      await release({ nextFireAt: windowAt });
      await scheduler.schedule(r.id, windowAt, r.attempt);
      await d.prisma.notificationEvent.create({ data: { userId: r.userId, reminderId: r.id, type: 'SUPPRESSED', metadata: { reason: 'delivery_window', deferredUntil: windowAt.toISOString() } } });
      return { status: 'deferred', until: windowAt };
    }

    const ent = await entitlementsFor(d.prisma, r.userId);
    const constant = r.constant && ent.features['reminders.constant'];
    const decision = decideChannels(task.priority, prefs, { constant, emailEntitled: ent.features['reminders.email'], attempt: r.attempt });
    const occurrence = r.occurrenceAt ?? r.nextFireAt ?? now;
    const key = deliveryKey(r.id, occurrence, r.attempt);

    let notificationId: string | null = null;
    if (decision.deliver) {
      const due = task.dueAt ? DateTime.fromJSDate(task.dueAt).setZone(r.user.timezone) : null;
      const whenLabel = due ? (task.allDay ? due.toFormat('ccc d LLL') : due.toFormat('ccc d LLL, HH:mm')) : 'now';
      const title = r.subtask ? r.subtask.title : task.title;
      const repeatNote = r.attempt > 0 ? ` · reminder ${r.attempt + 1}` : '';
      const existing = await d.prisma.notification.findUnique({ where: { dedupeKey: key } });
      const n =
        existing ??
        (await d.prisma.notification.create({
          data: {
            userId: r.userId,
            taskId: task.id,
            reminderId: r.id,
            kind: 'REMINDER',
            priority: task.priority,
            title,
            body: `${earlyLabel(r.offsetMinutes)}${task.project.name} · due ${whenLabel}${repeatNote}`,
            silent: decision.silent,
            dedupeKey: key,
            data: { attempt: r.attempt, occurrence: occurrence.toISOString(), sound: task.alarmSound ?? 'alarm' },
          },
        }));
      notificationId = n.id;

      // Earlier unacknowledged alerts for this reminder are superseded by this one.
      const older = await d.prisma.notification.findMany({ where: { reminderId: r.id, acknowledgedAt: null, id: { not: n.id } } });
      if (older.length) {
        await d.prisma.notification.updateMany({ where: { id: { in: older.map((o) => o.id) } }, data: { acknowledgedAt: now, resolution: 'superseded' } });
        for (const o of older) d.emitter.to(realtimeRooms.user(r.userId)).emit('notification.resolved', { notificationId: o.id, reminderId: r.id, resolution: 'superseded' });
      }

      if (!existing) {
        await deliver(d, n, decision.channels, { silent: decision.silent, link: `${d.env.WEB_URL}/app/task?id=${task.id}`, whenLabel });
        if (task.priority === 'CRITICAL') {
          await scheduler.webhook?.({ userId: r.userId, event: 'alert.critical', payload: { title, body: n.body, link: `${d.env.WEB_URL}/app/task?id=${task.id}` } });
        }
      }
    } else {
      await d.prisma.notificationEvent.create({ data: { userId: r.userId, reminderId: r.id, type: 'SUPPRESSED', metadata: { reason: decision.reason } } });
    }

    const next = nextRealertAt({ priority: task.priority, attempt: r.attempt, constant }, prefs, now);
    await release({ attempt: r.attempt + 1, lastFiredAt: now, nextFireAt: next, state: 'ACTIVE' });
    if (next) {
      await scheduler.schedule(r.id, next, r.attempt + 1);
      await d.prisma.notificationEvent.create({ data: { userId: r.userId, reminderId: r.id, type: 'SCHEDULED', metadata: { at: next.toISOString(), attempt: r.attempt + 1 } } });
    }
    return { status: 'fired', notificationId, channels: decision.channels, nextFireAt: next };
  } catch (e) {
    await release().catch(() => undefined);
    throw e;
  }
}

/**
 * Safety net: anything due (or due within the next minute) that isn't locked gets
 * (re-)queued. Covers Redis data loss, worker downtime and missed delayed jobs.
 */
export async function sweepDueReminders(d: Deps, scheduler: Scheduler, now = new Date()) {
  const due = await d.prisma.reminder.findMany({
    where: { state: { in: ['ACTIVE', 'SNOOZED'] }, nextFireAt: { lte: new Date(now.getTime() + 60_000) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    select: { id: true, nextFireAt: true, attempt: true },
    take: 1000,
    orderBy: { nextFireAt: 'asc' },
  });
  for (const r of due) await scheduler.schedule(r.id, r.nextFireAt!, r.attempt);
  return due.length;
}

export { dismissElsewhere };
