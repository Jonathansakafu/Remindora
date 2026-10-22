import { DateTime } from 'luxon';
import { RRule, rrulestr, type Options } from 'rrule';

/**
 * Timezone-correct recurrence.
 *
 * rrule computes in "floating" time, so we project the series start into the
 * user's wall clock, run the rule there, and map each result back to UTC.
 * That keeps "every Friday at 4pm" at 4pm local across DST transitions.
 */

export interface RecurrenceSpec {
  rrule: string;
  /** Series anchor (first occurrence) as a UTC instant. */
  dtstart: Date;
  timezone: string;
  mode?: 'FROM_DUE' | 'FROM_COMPLETION';
  until?: Date | null;
}

function toFloating(instant: Date, timezone: string): Date {
  const local = DateTime.fromJSDate(instant).setZone(timezone);
  return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second));
}

function fromFloating(floating: Date, timezone: string): Date {
  return DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone: timezone },
  ).toJSDate();
}

/** Parses an RRULE body (with or without the "RRULE:" prefix) into options, stripping DTSTART/TZID. */
export function parseRRule(rule: string): Partial<Options> {
  const body = rule
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('DTSTART'))
    .join('\n')
    .replace(/^RRULE:/, '');
  const parsed = RRule.parseString(body);
  delete parsed.dtstart;
  delete parsed.tzid;
  return parsed;
}

export function validateRRule(rule: string): boolean {
  try {
    const opts = parseRRule(rule);
    return opts.freq !== undefined;
  } catch {
    return false;
  }
}

function buildRule(spec: RecurrenceSpec): RRule {
  const opts = parseRRule(spec.rrule);
  const until = spec.until ?? opts.until ?? null;
  return new RRule({
    ...opts,
    dtstart: toFloating(spec.dtstart, spec.timezone),
    until: until ? toFloating(until, spec.timezone) : null,
  });
}

/**
 * Next occurrence strictly after `after`.
 * - FROM_DUE: next rule occurrence after the previous due date.
 * - FROM_COMPLETION: the rule's interval added to the completion time, keeping the
 *   original wall-clock time-of-day (e.g. "every 3 days after completion at 9am").
 */
export function nextOccurrence(spec: RecurrenceSpec, after: Date, completedAt?: Date): Date | null {
  if (spec.mode === 'FROM_COMPLETION' && completedAt) {
    return nextFromCompletion(spec, completedAt);
  }
  const rule = buildRule(spec);
  const next = rule.after(toFloating(after, spec.timezone), false);
  return next ? fromFloating(next, spec.timezone) : null;
}

function nextFromCompletion(spec: RecurrenceSpec, completedAt: Date): Date | null {
  const opts = parseRRule(spec.rrule);
  const interval = opts.interval ?? 1;
  const anchor = DateTime.fromJSDate(spec.dtstart).setZone(spec.timezone);
  const done = DateTime.fromJSDate(completedAt).setZone(spec.timezone);
  const unit =
    opts.freq === RRule.DAILY ? 'days' : opts.freq === RRule.WEEKLY ? 'weeks' : opts.freq === RRule.MONTHLY ? 'months' : opts.freq === RRule.YEARLY ? 'years' : opts.freq === RRule.HOURLY ? 'hours' : null;
  if (!unit) return null;
  let next = done.plus({ [unit]: interval });
  if (unit !== 'hours') next = next.set({ hour: anchor.hour, minute: anchor.minute, second: 0, millisecond: 0 });
  const until = spec.until ?? opts.until;
  if (until && next.toJSDate() > until) return null;
  return next.toJSDate();
}

/** Occurrences within [from, to] — used to project recurring tasks onto calendar views. */
export function occurrencesBetween(spec: RecurrenceSpec, from: Date, to: Date, limit = 500): Date[] {
  const rule = buildRule(spec);
  const out: Date[] = [];
  rule.between(toFloating(from, spec.timezone), toFloating(to, spec.timezone), true, (d) => {
    out.push(fromFloating(d, spec.timezone));
    return out.length < limit;
  });
  return out;
}

export function describeRRule(rule: string): string {
  try {
    return new RRule(parseRRule(rule)).toText();
  } catch {
    return 'Custom repeat';
  }
}

export { rrulestr };
