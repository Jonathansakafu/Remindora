import { DateTime } from 'luxon';

/**
 * Timezone helpers. Everything persisted is UTC; these convert between UTC
 * instants and the wall-clock of the user's selected IANA timezone.
 */

export function zoned(instant: Date | string, timezone: string): DateTime {
  const dt = typeof instant === 'string' ? DateTime.fromISO(instant, { zone: 'utc' }) : DateTime.fromJSDate(instant);
  return dt.setZone(timezone);
}

export function startOfLocalDay(instant: Date, timezone: string): Date {
  return zoned(instant, timezone).startOf('day').toJSDate();
}

export function endOfLocalDay(instant: Date, timezone: string): Date {
  return zoned(instant, timezone).endOf('day').toJSDate();
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateKey(instant: Date | string, timezone: string): string {
  return zoned(instant, timezone).toISODate()!;
}

/** Converts a wall-clock time in `timezone` to a UTC Date. */
export function fromLocal(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  timezone: string,
): Date {
  return DateTime.fromObject({ ...parts, hour: parts.hour ?? 0, minute: parts.minute ?? 0, second: 0, millisecond: 0 }, { zone: timezone }).toJSDate();
}

/** Parses "HH:MM" into minutes after midnight. */
export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface SmartRange {
  from: Date | null;
  to: Date | null;
}

/** Date windows used by Today / Upcoming / Overdue smart lists in a user's timezone. */
export function smartListRange(view: 'today' | 'upcoming' | 'overdue', now: Date, timezone: string, upcomingDays = 7): SmartRange {
  const local = zoned(now, timezone);
  switch (view) {
    case 'today':
      return { from: null, to: local.endOf('day').toJSDate() };
    case 'upcoming':
      return {
        from: local.plus({ days: 1 }).startOf('day').toJSDate(),
        to: local.plus({ days: upcomingDays }).endOf('day').toJSDate(),
      };
    case 'overdue':
      return { from: null, to: now };
  }
}

/** Overdue rule: timed tasks are overdue after their due instant, all-day tasks once their local day has passed. */
export function isOverdue(task: { dueAt: Date | string | null; allDay: boolean; completedAt?: Date | string | null }, now: Date, timezone: string): boolean {
  if (!task.dueAt || task.completedAt) return false;
  const due = typeof task.dueAt === 'string' ? new Date(task.dueAt) : task.dueAt;
  if (task.allDay) return localDateKey(due, timezone) < localDateKey(now, timezone);
  return due.getTime() < now.getTime();
}

export function isWeekend(instant: Date, timezone: string): boolean {
  return zoned(instant, timezone).weekday >= 6;
}
