import { DateTime } from 'luxon';
import type { Priority } from '@remindora/types';

/**
 * Quick Add natural-language parser.
 *
 *   "Submit report every Friday at 4pm #work !high"
 *     → title "Submit report", weekly on Friday, due next Friday 16:00 local,
 *       tag "work", priority HIGH.
 *
 * Tokens are extracted in a fixed order and removed from the title. Each match
 * is reported in `tokens` so the Quick Add UI can highlight what was understood.
 */

export interface ParseOptions {
  now?: Date;
  timezone: string;
  /** 1 = Monday (ISO), 7 = Sunday. Used for "next week". */
  weekStartsOn?: 1 | 7 | 6;
  /** How to read numeric dates like 03/04. */
  dateOrder?: 'MDY' | 'DMY';
}

export type TokenKind = 'tag' | 'priority' | 'project' | 'assignee' | 'date' | 'time' | 'recurrence' | 'duration' | 'reminder';

export interface ParsedToken {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

export interface ParsedTask {
  title: string;
  dueAt: string | null;
  startAt: string | null;
  allDay: boolean;
  durationMinutes: number | null;
  priority: Priority | null;
  tags: string[];
  projectName: string | null;
  assignee: string | null;
  recurrence: { rrule: string; mode: 'FROM_DUE' | 'FROM_COMPLETION' } | null;
  reminderOffsets: number[];
  tokens: ParsedToken[];
}

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};
const RRULE_DAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const WEEKDAY_RE = '(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)';
const MONTH_RE = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
const UNIT_MIN: Record<string, number> = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440 };

interface Clock {
  hour: number;
  minute: number;
}

class Scanner {
  readonly tokens: ParsedToken[] = [];
  private masked: string;

  constructor(readonly source: string) {
    this.masked = source;
  }

  /** Finds the first match not overlapping an already-consumed span and consumes it. */
  take(re: RegExp, kind: TokenKind): RegExpExecArray | null {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = global.exec(this.masked))) {
      if (m[0].trim() === '') {
        global.lastIndex++;
        continue;
      }
      const lead = m[0].length - m[0].trimStart().length;
      const start = m.index + lead;
      const end = m.index + m[0].trimEnd().length;
      this.tokens.push({ kind, text: this.source.slice(start, end), start, end });
      this.masked = this.masked.slice(0, start) + '\u0000'.repeat(end - start) + this.masked.slice(end);
      return m;
    }
    return null;
  }

  takeAll(re: RegExp, kind: TokenKind): RegExpExecArray[] {
    const out: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = this.take(re, kind))) out.push(m);
    return out;
  }

  remainder(): string {
    return this.masked
      .replace(/\u0000+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim()
      .replace(/^(?:on|at|by|due|from|every)\s+/i, '')
      .replace(/\s+(?:on|at|by|due|from|and|,)$/i, '')
      .replace(/[,;:]+$/, '')
      .trim();
  }
}

function parseClock(h: string, m: string | undefined, meridiem: string | undefined, bare = false): Clock | null {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  if (minute > 59 || hour > 23) return null;
  const mer = meridiem?.toLowerCase().replace(/\./g, '');
  if (mer === 'pm' || mer === 'p') {
    if (hour < 12) hour += 12;
  } else if (mer === 'am' || mer === 'a') {
    if (hour === 12) hour = 0;
  } else if (bare && hour >= 1 && hour <= 7) {
    // "at 4" almost always means the afternoon.
    hour += 12;
  }
  return { hour, minute };
}

function parseDuration(text: string): number | null {
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m)(?![a-z])/gi;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(text))) {
    found = true;
    total += Number(m[1]) * (UNIT_MIN[m[2]!.toLowerCase()] ?? 0);
  }
  return found ? Math.round(total) : null;
}

export function parseQuickAdd(input: string, options: ParseOptions): ParsedTask {
  const tz = options.timezone;
  const now = DateTime.fromJSDate(options.now ?? new Date()).setZone(tz);
  const s = new Scanner(input);

  // 1. Tags, priority, project, assignee — explicit sigils first.
  const tags = s.takeAll(/(?<=^|\s)#([\p{L}\p{N}_\-/]+)/u, 'tag').map((m) => m[1]!.toLowerCase());

  let priority: Priority | null = null;
  const pri = s.take(/(?<=^|\s)!(critical|urgent|high|medium|med|low|none|p0|p1|p2|p3|p4|!!|!)(?=\s|$)/i, 'priority');
  if (pri) {
    const v = pri[1]!.toLowerCase();
    priority =
      v === 'critical' || v === 'urgent' || v === 'p0' || v === '!!'
        ? 'CRITICAL'
        : v === 'high' || v === 'p1' || v === '!'
          ? 'HIGH'
          : v === 'medium' || v === 'med' || v === 'p2'
            ? 'MEDIUM'
            : v === 'low' || v === 'p3'
              ? 'LOW'
              : 'NONE';
  }

  const proj = s.take(/(?<=^|\s)~(?:"([^"]+)"|([\p{L}\p{N}_\-]+))/u, 'project');
  const projectName = proj ? (proj[1] ?? proj[2] ?? null) : null;

  const asg = s.take(/(?<=^|\s)@([\p{L}\p{N}_.\-]+)(?=\s|$)/u, 'assignee');
  const assignee = asg ? asg[1]! : null;

  // 2. Reminders ("remind me 15m before").
  const reminderOffsets: number[] = [];
  for (const m of s.takeAll(/\bremind(?:\s+me)?\s+(\d+)\s*(minutes|minute|mins|min|m|hours|hour|hrs|hr|h|days|day|d)\s+(?:before|early|ahead)\b/i, 'reminder')) {
    reminderOffsets.push(Number(m[1]) * (UNIT_MIN[m[2]!.toLowerCase()] ?? 0));
  }

  // 3. Time ranges ("from 2pm to 3:30pm", "2-3pm") → start + duration.
  let time: Clock | null = null;
  let durationMinutes: number | null = null;
  const range = s.take(
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i,
    'time',
  );
  if (range) {
    const endMer = range[6];
    const end = parseClock(range[4]!, range[5], endMer);
    let start = parseClock(range[1]!, range[2], range[3] ?? endMer);
    if (start && end && !range[3] && start.hour * 60 + start.minute > end.hour * 60 + end.minute) {
      start = parseClock(range[1]!, range[2], 'am');
    }
    if (start && end) {
      time = start;
      const diff = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
      if (diff > 0) durationMinutes = diff;
    }
  }

  // 4. Duration ("for 30m", "for 1h30m", "for 2 hours").
  const dur = s.take(/\bfor\s+((?:\d+(?:\.\d+)?\s*(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|m)(?![a-z])\s*){1,2})/i, 'duration');
  if (dur) durationMinutes = parseDuration(dur[1]!);

  // 5. Recurrence.
  let recurrence: ParsedTask['recurrence'] = null;
  let recurrenceWeekdays: number[] = [];
  let recurrenceMonthDay: number | null = null;
  const fromCompletion = s.take(/\b(?:after|from)\s+(?:completion|completing|done)\b/i, 'recurrence');
  const mode = fromCompletion ? 'FROM_COMPLETION' : 'FROM_DUE';

  const everyDays = s.take(new RegExp(`\\bevery\\s+(${WEEKDAY_RE}(?:\\s*(?:,|and|&|/)\\s*${WEEKDAY_RE})*)\\b`, 'i'), 'recurrence');
  if (everyDays) {
    recurrenceWeekdays = [...everyDays[1]!.toLowerCase().matchAll(new RegExp(WEEKDAY_RE, 'gi'))]
      .map((d) => WEEKDAYS[d[0].toLowerCase()]!)
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .sort();
    recurrence = { rrule: `FREQ=WEEKLY;BYDAY=${recurrenceWeekdays.map((d) => RRULE_DAY[d]).join(',')}`, mode };
  }
  if (!recurrence) {
    const m = s.take(/\bevery\s+(?:(other|\d+)\s+)?(days?|weeks?|months?|years?|weekdays?|weekends?|hours?)\b/i, 'recurrence');
    if (m) {
      const n = m[1]?.toLowerCase() === 'other' ? 2 : m[1] ? Number(m[1]) : 1;
      const unit = m[2]!.toLowerCase().replace(/s$/, '');
      const iv = n > 1 ? `;INTERVAL=${n}` : '';
      if (unit === 'weekday') {
        recurrenceWeekdays = [1, 2, 3, 4, 5];
        recurrence = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', mode };
      } else if (unit === 'weekend') {
        recurrenceWeekdays = [6, 7];
        recurrence = { rrule: 'FREQ=WEEKLY;BYDAY=SA,SU', mode };
      } else {
        const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY', hour: 'HOURLY' }[unit]!;
        recurrence = { rrule: `FREQ=${freq}${iv}`, mode };
      }
    }
  }
  if (!recurrence) {
    const m = s.take(/\b(daily|weekly|fortnightly|biweekly|monthly|yearly|annually|hourly)\b/i, 'recurrence');
    if (m) {
      const word = m[1]!.toLowerCase();
      const rrule =
        word === 'daily' ? 'FREQ=DAILY'
        : word === 'weekly' ? 'FREQ=WEEKLY'
        : word === 'fortnightly' || word === 'biweekly' ? 'FREQ=WEEKLY;INTERVAL=2'
        : word === 'monthly' ? 'FREQ=MONTHLY'
        : word === 'hourly' ? 'FREQ=HOURLY'
        : 'FREQ=YEARLY';
      recurrence = { rrule, mode };
    }
  }
  if (!recurrence) {
    const m = s.take(/\bevery\s+(?:month\s+on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(?:the|every)\s+month)?/i, 'recurrence');
    if (m) {
      recurrenceMonthDay = Math.min(31, Number(m[1]));
      recurrence = { rrule: `FREQ=MONTHLY;BYMONTHDAY=${recurrenceMonthDay}`, mode };
    }
  }

  // 6. Times.
  let explicitInstant: DateTime | null = null;
  if (!time) {
    const rel = s.take(/\bin\s+(\d+|an?|half\s+an)\s*(minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/i, 'time');
    if (rel) {
      const n = /half/i.test(rel[1]!) ? 0.5 : /^an?$/i.test(rel[1]!) ? 1 : Number(rel[1]);
      const minutes = n * (UNIT_MIN[rel[2]!.toLowerCase()] ?? 0);
      explicitInstant = now.plus({ minutes }).set({ second: 0, millisecond: 0 });
    }
  }
  if (!time && !explicitInstant) {
    const at = s.take(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?(?=\s|$|[,.;])/i, 'time');
    if (at) time = parseClock(at[1]!, at[2], at[3], !at[3] && !at[2]);
  }
  if (!time && !explicitInstant) {
    const bare = s.take(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.;])/i, 'time');
    if (bare) time = parseClock(bare[1]!, bare[2], bare[3]);
  }
  if (!time && !explicitInstant) {
    const h24 = s.take(/\b([01]?\d|2[0-3]):([0-5]\d)\b/, 'time');
    if (h24) time = { hour: Number(h24[1]), minute: Number(h24[2]) };
  }
  if (!time && !explicitInstant) {
    const named = s.take(/\b(noon|midday|midnight|(?:this\s+|in\s+the\s+)?(?:morning|afternoon|evening)|tonight)\b/i, 'time');
    if (named) {
      const w = named[1]!.toLowerCase();
      time = w.includes('noon') || w === 'midday' ? { hour: 12, minute: 0 }
        : w === 'midnight' ? { hour: 23, minute: 59 }
        : w.includes('morning') ? { hour: 9, minute: 0 }
        : w.includes('afternoon') ? { hour: 14, minute: 0 }
        : { hour: 19, minute: 0 };
      if (w === 'tonight') time = { hour: 20, minute: 0 };
    }
  }

  // 7. Dates.
  let date: DateTime | null = null;
  const today = now.startOf('day');
  const dt = s.take(/\b(day\s+after\s+tomorrow|today|tod|tomorrow|tmrw|tmr|tonight)\b/i, 'date');
  if (dt) {
    const w = dt[1]!.toLowerCase();
    date = w.startsWith('day') ? today.plus({ days: 2 }) : w.startsWith('to') && w !== 'tomorrow' ? today : today.plus({ days: 1 });
    if (w === 'tonight' && !time) time = { hour: 20, minute: 0 };
  }
  if (!date) {
    const m = s.take(/\bin\s+(\d+|a|an|one|two|three)\s+(days?|weeks?|months?|years?)\b/i, 'date');
    if (m) {
      const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
      const n = words[m[1]!.toLowerCase()] ?? Number(m[1]);
      const unit = m[2]!.toLowerCase().replace(/s$/, '') + 's';
      date = today.plus({ [unit]: n });
    }
  }
  if (!date) {
    const m = s.take(/\b(next|this)\s+(week|month|year|weekend)\b/i, 'date');
    if (m) {
      const which = m[1]!.toLowerCase();
      const unit = m[2]!.toLowerCase();
      const ws = options.weekStartsOn ?? 1;
      if (unit === 'weekend') {
        const base = which === 'next' ? today.plus({ weeks: 1 }) : today;
        date = base.plus({ days: (6 - base.weekday + 7) % 7 });
      } else if (unit === 'week') {
        const startOffset = (ws - today.weekday + 7) % 7 || 7;
        date = which === 'next' ? today.plus({ days: startOffset }) : today.endOf('week').startOf('day');
      } else if (unit === 'month') {
        date = which === 'next' ? today.plus({ months: 1 }).startOf('month') : today.endOf('month').startOf('day');
      } else {
        date = which === 'next' ? today.plus({ years: 1 }).startOf('year') : today.endOf('year').startOf('day');
      }
    }
  }
  if (!date) {
    const m = s.take(/\b(end\s+of\s+(?:the\s+)?month|eom|end\s+of\s+(?:the\s+)?week|eow)\b/i, 'date');
    if (m) date = /month|eom/i.test(m[1]!) ? today.endOf('month').startOf('day') : today.endOf('week').startOf('day');
  }
  if (!date) {
    // ISO 2026-11-01
    const m = s.take(/\b(\d{4})-(\d{2})-(\d{2})\b/, 'date');
    if (m) date = DateTime.fromObject({ year: +m[1]!, month: +m[2]!, day: +m[3]! }, { zone: tz });
  }
  if (!date) {
    // "Jan 5", "January 5th 2027", "on jan 5"
    const m = s.take(new RegExp(`\\b(?:on\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), 'date');
    if (m) date = resolveCalendarDate(today, MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), m[3] ? Number(m[3]) : null, tz);
  }
  if (!date) {
    // "5 Jan", "5th of January 2027"
    const m = s.take(new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s+(\\d{4}))?`, 'i'), 'date');
    if (m) date = resolveCalendarDate(today, MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), m[3] ? Number(m[3]) : null, tz);
  }
  if (!date) {
    // 11/05 or 11/05/2026
    const m = s.take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, 'date');
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      const [month, day] = options.dateOrder === 'DMY' ? [b, a] : [a, b];
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) date = resolveCalendarDate(today, month, day, year, tz);
    }
  }
  if (!date) {
    const m = s.take(new RegExp(`\\b(?:on\\s+)?(?:(next|this)\\s+)?(${WEEKDAY_RE})\\b`, 'i'), 'date');
    if (m) {
      const target = WEEKDAYS[m[2]!.toLowerCase()]!;
      let delta = (target - today.weekday + 7) % 7;
      // "next friday" never means today; a bare "friday" can.
      if (m[1]?.toLowerCase() === 'next' && delta === 0) delta = 7;
      date = today.plus({ days: delta });
      if (delta === 0 && time && today.set(time) <= now) date = today.plus({ days: 7 });
    }
  }
  if (!date && !recurrence) {
    // "on the 15th"
    const m = s.take(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, 'date');
    if (m) {
      const day = Number(m[1]);
      let candidate = today.set({ day: Math.min(day, today.daysInMonth!) });
      if (candidate < today) candidate = today.plus({ months: 1 }).set({ day: Math.min(day, today.plus({ months: 1 }).daysInMonth!) });
      date = candidate;
    }
  }

  // 8. Resolve the first due instant.
  let dueAt: DateTime | null = explicitInstant;
  let allDay = false;
  if (!dueAt) {
    if (!date && recurrenceWeekdays.length) {
      date = firstMatchingWeekday(today, now, recurrenceWeekdays, time);
    } else if (!date && recurrenceMonthDay) {
      let candidate = today.set({ day: Math.min(recurrenceMonthDay, today.daysInMonth!) });
      if (candidate < today || (candidate.equals(today) && time && today.set(time) <= now)) {
        const nm = today.plus({ months: 1 });
        candidate = nm.set({ day: Math.min(recurrenceMonthDay, nm.daysInMonth!) });
      }
      date = candidate;
    } else if (!date && (time || recurrence)) {
      // A time that already passed today rolls to tomorrow.
      date = time && today.set(time) <= now ? today.plus({ days: 1 }) : today;
    }
    if (date) {
      if (time) {
        dueAt = DateTime.fromObject({ year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute }, { zone: tz });
      } else {
        dueAt = DateTime.fromObject({ year: date.year, month: date.month, day: date.day }, { zone: tz });
        allDay = true;
      }
    }
  }

  let startAt: string | null = null;
  if (range && dueAt) startAt = dueAt.toUTC().toISO();

  const title = s.remainder() || input.trim();
  return {
    title,
    dueAt: dueAt ? dueAt.toUTC().toISO() : null,
    startAt,
    allDay,
    durationMinutes,
    priority,
    tags: [...new Set(tags)],
    projectName,
    assignee,
    recurrence,
    reminderOffsets,
    tokens: s.tokens.sort((a, b) => a.start - b.start),
  };
}

function resolveCalendarDate(today: DateTime, month: number, day: number, year: number | null, tz: string): DateTime | null {
  const y = year ?? today.year;
  let d = DateTime.fromObject({ year: y, month, day }, { zone: tz });
  if (!d.isValid) return null;
  if (!year && d < today) d = d.plus({ years: 1 });
  return d;
}

function firstMatchingWeekday(today: DateTime, now: DateTime, weekdays: number[], time: Clock | null): DateTime {
  for (let i = 0; i < 8; i++) {
    const d = today.plus({ days: i });
    if (!weekdays.includes(d.weekday)) continue;
    if (i === 0 && time && d.set(time) <= now) continue;
    return d;
  }
  return today;
}
