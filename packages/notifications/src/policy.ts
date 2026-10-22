import { DateTime } from 'luxon';
import type { NotificationChannel, Priority } from '@remindora/types';

/**
 * Priority notification policy. Pure functions only — the workers and API decide
 * *when* and *where* to alert by calling these, so behaviour is unit-testable and
 * identical everywhere.
 *
 *  CRITICAL  push + desktop + web push (+ email if opted in), re-alert every
 *            `criticalRepeatMinutes` (default 30) until completed/snoozed/acknowledged.
 *  HIGH      due-time alert, re-alert every `highRepeatMinutes` (default 2h) until acknowledged.
 *  MEDIUM    single due-time alert, optional one follow-up.
 *  LOW/NONE  silent notification-center item, or morning digest only.
 *
 * Every repeat is bounded by `maxRealerts`. Nothing here is mandatory: every
 * interval and channel comes from user preferences with per-project overrides.
 */

export interface ChannelPrefs {
  push: boolean;
  desktop: boolean;
  webPush: boolean;
  email: boolean;
  inApp: boolean;
}

export interface NotificationPrefs {
  timezone: string;
  channels: ChannelPrefs;
  criticalRepeatMinutes: number;
  highRepeatMinutes: number;
  mediumFollowUpMinutes: number | null;
  maxRealerts: number;
  criticalEmail: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  criticalBypassQuietHours: boolean;
  weekendsEnabled: boolean;
  lowPriorityMode: 'inbox' | 'digest';
  morningDigestEnabled: boolean;
  morningDigestTime: string;
  eveningPlanningEnabled: boolean;
  eveningPlanningTime: string;
}

export interface ProjectOverride {
  muted: boolean;
  channels?: Partial<ChannelPrefs> | null;
  criticalRepeatMinutes?: number | null;
  highRepeatMinutes?: number | null;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  timezone: 'UTC',
  channels: { push: true, desktop: true, webPush: true, email: false, inApp: true },
  criticalRepeatMinutes: 30,
  highRepeatMinutes: 120,
  mediumFollowUpMinutes: null,
  maxRealerts: 10,
  criticalEmail: false,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  criticalBypassQuietHours: false,
  weekendsEnabled: true,
  lowPriorityMode: 'inbox',
  morningDigestEnabled: true,
  morningDigestTime: '08:00',
  eveningPlanningEnabled: false,
  eveningPlanningTime: '20:00',
};

export interface EffectivePrefs extends NotificationPrefs {
  muted: boolean;
}

export function resolvePrefs(prefs: Partial<NotificationPrefs> | null | undefined, override?: ProjectOverride | null): EffectivePrefs {
  const base: NotificationPrefs = { ...DEFAULT_PREFS, ...(prefs ?? {}), channels: { ...DEFAULT_PREFS.channels, ...(prefs?.channels ?? {}) } };
  if (!override) return { ...base, muted: false };
  return {
    ...base,
    channels: { ...base.channels, ...(override.channels ?? {}) },
    criticalRepeatMinutes: override.criticalRepeatMinutes ?? base.criticalRepeatMinutes,
    highRepeatMinutes: override.highRepeatMinutes ?? base.highRepeatMinutes,
    muted: override.muted,
  };
}

export interface DeliveryDecision {
  /** False → nothing is sent now (e.g. digest-only). */
  deliver: boolean;
  channels: NotificationChannel[];
  /** In-app item without sound/heads-up. */
  silent: boolean;
  reason: string;
}

export function decideChannels(priority: Priority, prefs: EffectivePrefs, opts: { constant?: boolean; emailEntitled?: boolean } = {}): DeliveryDecision {
  const inApp: NotificationChannel[] = prefs.channels.inApp ? ['IN_APP'] : [];
  if (prefs.muted) return { deliver: inApp.length > 0, channels: inApp, silent: true, reason: 'project_muted' };

  const effective = opts.constant && rank(priority) < rank('HIGH') ? 'HIGH' : priority;
  if (effective === 'NONE' || effective === 'LOW') {
    if (prefs.lowPriorityMode === 'digest') return { deliver: false, channels: [], silent: true, reason: 'digest_only' };
    return { deliver: inApp.length > 0, channels: inApp, silent: true, reason: 'low_priority_silent' };
  }

  const channels: NotificationChannel[] = [...inApp];
  if (prefs.channels.push) channels.push('PUSH');
  if (prefs.channels.desktop) channels.push('DESKTOP');
  if (prefs.channels.webPush) channels.push('WEB_PUSH');
  if (effective === 'CRITICAL' && prefs.criticalEmail && prefs.channels.email && opts.emailEntitled !== false) channels.push('EMAIL');
  return { deliver: channels.length > 0, channels, silent: false, reason: effective.toLowerCase() };
}

const RANKS: Record<Priority, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export function rank(p: Priority): number {
  return RANKS[p];
}

export interface RepeatContext {
  priority: Priority;
  /** Zero-based count of alerts already delivered for this reminder. */
  attempt: number;
  constant?: boolean;
}

/**
 * When should the next re-alert fire after an alert at `firedAt`?
 * Returns null when the policy says stop.
 */
export function nextRealertAt(ctx: RepeatContext, prefs: EffectivePrefs, firedAt: Date): Date | null {
  if (prefs.muted) return null;
  const sent = ctx.attempt + 1;
  const effective = ctx.constant && rank(ctx.priority) < rank('HIGH') ? 'HIGH' : ctx.priority;
  let minutes: number | null = null;
  if (effective === 'CRITICAL') minutes = prefs.criticalRepeatMinutes;
  else if (effective === 'HIGH') minutes = prefs.highRepeatMinutes;
  else if (effective === 'MEDIUM') minutes = sent === 1 ? prefs.mediumFollowUpMinutes : null;
  if (!minutes || minutes <= 0) return null;
  // maxRealerts bounds *re*-alerts: the first alert plus up to maxRealerts repeats.
  if (effective !== 'MEDIUM' && sent > prefs.maxRealerts) return null;
  const next = new Date(firedAt.getTime() + minutes * 60_000);
  return applyDeliveryWindow(next, prefs, ctx.priority);
}

function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inQuietHours(at: Date, prefs: Pick<NotificationPrefs, 'timezone' | 'quietHoursEnabled' | 'quietStart' | 'quietEnd'>): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const local = DateTime.fromJSDate(at).setZone(prefs.timezone);
  const mins = local.hour * 60 + local.minute;
  const start = clockMinutes(prefs.quietStart);
  const end = clockMinutes(prefs.quietEnd);
  if (start === end) return false;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

/**
 * Defers an alert out of quiet hours and (optionally) weekends, in the user's
 * timezone. Critical alerts only bypass these when the user explicitly allowed it.
 */
export function applyDeliveryWindow(at: Date, prefs: NotificationPrefs, priority: Priority): Date {
  if (priority === 'CRITICAL' && prefs.criticalBypassQuietHours) return at;
  let local = DateTime.fromJSDate(at).setZone(prefs.timezone);
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    if (inQuietHours(local.toJSDate(), prefs)) {
      const end = clockMinutes(prefs.quietEnd);
      let target = local.startOf('day').plus({ minutes: end });
      if (target <= local) target = target.plus({ days: 1 });
      local = target;
      moved = true;
    }
    if (!prefs.weekendsEnabled && local.weekday >= 6) {
      const startMins = prefs.quietHoursEnabled ? clockMinutes(prefs.quietEnd) : 9 * 60;
      local = local.plus({ days: 8 - local.weekday }).startOf('day').plus({ minutes: startMins });
      moved = true;
    }
    if (!moved) break;
  }
  return local.toJSDate();
}

/** First fire time for a reminder: absolute `at`, or `offsetMinutes` before the due date. */
export function initialFireAt(
  reminder: { at: Date | null; offsetMinutes: number | null },
  task: { dueAt: Date | null; allDay: boolean },
  prefs: NotificationPrefs,
  priority: Priority,
): Date | null {
  let at: Date | null = reminder.at;
  if (!at && task.dueAt) {
    let due = task.dueAt;
    if (task.allDay) {
      // All-day tasks alert at the start of the user's morning digest time on the due date.
      const local = DateTime.fromJSDate(due).setZone(prefs.timezone).startOf('day').plus({ minutes: clockMinutes(prefs.morningDigestTime) });
      due = local.toJSDate();
    }
    at = new Date(due.getTime() - (reminder.offsetMinutes ?? 0) * 60_000);
  }
  return at ? applyDeliveryWindow(at, prefs, priority) : null;
}

export type ReminderAction = 'acknowledge' | 'complete' | 'snooze' | 'stop' | 'reschedule';

export interface ReminderStateChange {
  state: 'ACTIVE' | 'SNOOZED' | 'ACKNOWLEDGED' | 'STOPPED' | 'DONE';
  nextFireAt: Date | null;
  event: 'ACKNOWLEDGED' | 'COMPLETED' | 'SNOOZED' | 'STOPPED';
}

/** State transition for a one-tap notification action. */
export function applyReminderAction(action: ReminderAction, opts: { now: Date; snoozeMinutes?: number; rescheduleTo?: Date }): ReminderStateChange {
  switch (action) {
    case 'acknowledge':
      return { state: 'ACKNOWLEDGED', nextFireAt: null, event: 'ACKNOWLEDGED' };
    case 'complete':
      return { state: 'DONE', nextFireAt: null, event: 'COMPLETED' };
    case 'stop':
      return { state: 'STOPPED', nextFireAt: null, event: 'STOPPED' };
    case 'snooze': {
      const minutes = Math.min(Math.max(opts.snoozeMinutes ?? 10, 1), 24 * 60);
      return { state: 'SNOOZED', nextFireAt: new Date(opts.now.getTime() + minutes * 60_000), event: 'SNOOZED' };
    }
    case 'reschedule':
      if (!opts.rescheduleTo) throw new Error('rescheduleTo is required');
      return { state: 'ACTIVE', nextFireAt: opts.rescheduleTo, event: 'SNOOZED' };
  }
}

/** Idempotency key so a reminder occurrence + attempt is delivered at most once per channel. */
export function deliveryKey(reminderId: string, occurrence: string | Date, attempt: number): string {
  const occ = typeof occurrence === 'string' ? occurrence : occurrence.toISOString();
  return `rem:${reminderId}:${occ}:${attempt}`;
}

/**
 * Should a digest (morning priorities / evening planning) be sent now?
 * Sends once per local day, only after the configured time and within a grace window
 * so a worker outage doesn't spam a stale morning digest at night.
 */
export function digestDue(kind: 'morning' | 'evening', prefs: NotificationPrefs, lastSentLocalDate: string | null, now: Date, graceHours = 3): boolean {
  const enabled = kind === 'morning' ? prefs.morningDigestEnabled : prefs.eveningPlanningEnabled;
  if (!enabled) return false;
  const local = DateTime.fromJSDate(now).setZone(prefs.timezone);
  if (!prefs.weekendsEnabled && local.weekday >= 6) return false;
  const today = local.toISODate()!;
  if (lastSentLocalDate === today) return false;
  const target = clockMinutes(kind === 'morning' ? prefs.morningDigestTime : prefs.eveningPlanningTime);
  const mins = local.hour * 60 + local.minute;
  return mins >= target && mins < target + graceHours * 60;
}
