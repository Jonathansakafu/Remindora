import { DateTime } from 'luxon';

/**
 * Habit streak maths over local calendar dates (YYYY-MM-DD).
 * DAILY habits may be limited to specific ISO weekdays; unscheduled days neither
 * break nor extend a streak. WEEKLY habits count weeks meeting `targetPerPeriod`.
 */

export interface HabitSchedule {
  frequency: 'DAILY' | 'WEEKLY';
  weekdays: number[];
  targetPerPeriod: number;
}

export interface StreakResult {
  current: number;
  best: number;
  /** Fraction (0..1) of scheduled periods completed in the trailing window. */
  consistency: number;
}

export function computeStreaks(schedule: HabitSchedule, checkIns: string[], today: string, windowDays = 30): StreakResult {
  const done = new Set(checkIns);
  return schedule.frequency === 'WEEKLY' ? weeklyStreaks(schedule, done, today, windowDays) : dailyStreaks(schedule, done, today, windowDays);
}

function isScheduled(schedule: HabitSchedule, d: DateTime): boolean {
  return schedule.weekdays.length === 0 || schedule.weekdays.includes(d.weekday);
}

function dailyStreaks(schedule: HabitSchedule, done: Set<string>, today: string, windowDays: number): StreakResult {
  const t = DateTime.fromISO(today);
  const sorted = [...done].sort();
  if (sorted.length === 0) return { current: 0, best: 0, consistency: 0 };

  // Current streak: walk back from today. An unchecked *today* doesn't break it yet.
  let current = 0;
  let cursor = t;
  if (!done.has(cursor.toISODate()!)) cursor = cursor.minus({ days: 1 });
  for (let i = 0; i < 3660; i++) {
    const key = cursor.toISODate()!;
    if (isScheduled(schedule, cursor)) {
      if (!done.has(key)) break;
      current++;
    }
    cursor = cursor.minus({ days: 1 });
  }

  // Best streak: scan forward from the first check-in.
  let best = 0;
  let run = 0;
  let d = DateTime.fromISO(sorted[0]!);
  while (d <= t) {
    if (isScheduled(schedule, d)) {
      if (done.has(d.toISODate()!)) {
        run++;
        best = Math.max(best, run);
      } else if (d < t) {
        run = 0;
      }
    }
    d = d.plus({ days: 1 });
  }

  let scheduled = 0;
  let hit = 0;
  for (let i = 0; i < windowDays; i++) {
    const day = t.minus({ days: i });
    if (!isScheduled(schedule, day)) continue;
    scheduled++;
    if (done.has(day.toISODate()!)) hit++;
  }
  return { current, best: Math.max(best, current), consistency: scheduled ? hit / scheduled : 0 };
}

function weeklyStreaks(schedule: HabitSchedule, done: Set<string>, today: string, windowDays: number): StreakResult {
  const t = DateTime.fromISO(today);
  const perWeek = new Map<string, number>();
  for (const key of done) {
    const wk = DateTime.fromISO(key).startOf('week').toISODate()!;
    perWeek.set(wk, (perWeek.get(wk) ?? 0) + 1);
  }
  const target = Math.max(1, schedule.targetPerPeriod);
  const met = (wk: DateTime) => (perWeek.get(wk.toISODate()!) ?? 0) >= target;

  let current = 0;
  let wk = t.startOf('week');
  if (!met(wk)) wk = wk.minus({ weeks: 1 });
  while (met(wk)) {
    current++;
    wk = wk.minus({ weeks: 1 });
  }

  const weeks = [...perWeek.keys()].sort();
  let best = 0;
  let run = 0;
  if (weeks.length) {
    let w = DateTime.fromISO(weeks[0]!);
    while (w <= t.startOf('week')) {
      if (met(w)) best = Math.max(best, ++run);
      else if (w < t.startOf('week')) run = 0;
      w = w.plus({ weeks: 1 });
    }
  }

  const windowWeeks = Math.max(1, Math.round(windowDays / 7));
  let hit = 0;
  for (let i = 0; i < windowWeeks; i++) if (met(t.startOf('week').minus({ weeks: i }))) hit++;
  return { current, best: Math.max(best, current), consistency: hit / windowWeeks };
}
