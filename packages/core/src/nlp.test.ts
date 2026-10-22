import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './nlp';

const tz = 'America/New_York';
// Wednesday 21 Oct 2026, 10:00 local
const now = DateTime.fromObject({ year: 2026, month: 10, day: 21, hour: 10 }, { zone: tz }).toJSDate();
const local = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(tz).toFormat("ccc yyyy-LL-dd HH:mm") : null);

describe('parseQuickAdd', () => {
  it('parses the canonical example', () => {
    const r = parseQuickAdd('Submit report every Friday at 4pm #work !high', { now, timezone: tz });
    expect(r.title).toBe('Submit report');
    expect(r.tags).toEqual(['work']);
    expect(r.priority).toBe('HIGH');
    expect(r.recurrence).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=FR', mode: 'FROM_DUE' });
    expect(local(r.dueAt)).toBe('Fri 2026-10-23 16:00');
    expect(r.allDay).toBe(false);
    expect(r.tokens.map((t) => t.kind).sort()).toEqual(['priority', 'recurrence', 'tag', 'time']);
  });

  it('handles tomorrow, times and project/assignee sigils', () => {
    const r = parseQuickAdd('Call dentist tomorrow 9:30am ~Personal @sam !p0', { now, timezone: tz });
    expect(r.title).toBe('Call dentist');
    expect(local(r.dueAt)).toBe('Thu 2026-10-22 09:30');
    expect(r.projectName).toBe('Personal');
    expect(r.assignee).toBe('sam');
    expect(r.priority).toBe('CRITICAL');
  });

  it('date without time is all-day', () => {
    const r = parseQuickAdd('Pay rent on Nov 1', { now, timezone: tz });
    expect(r.title).toBe('Pay rent');
    expect(r.allDay).toBe(true);
    expect(local(r.dueAt)).toBe('Sun 2026-11-01 00:00');
  });

  it('time already passed today rolls to tomorrow', () => {
    const r = parseQuickAdd('Stretch at 8am', { now, timezone: tz });
    expect(local(r.dueAt)).toBe('Thu 2026-10-22 08:00');
  });

  it('bare "at 4" means the afternoon', () => {
    expect(local(parseQuickAdd('Standup at 4', { now, timezone: tz }).dueAt)).toBe('Wed 2026-10-21 16:00');
  });

  it('parses ranges into start + duration', () => {
    const r = parseQuickAdd('Deep work friday 2-4pm', { now, timezone: tz });
    expect(r.title).toBe('Deep work');
    expect(local(r.dueAt)).toBe('Fri 2026-10-23 14:00');
    expect(r.startAt).toBe(r.dueAt);
    expect(r.durationMinutes).toBe(120);
  });

  it('parses durations and reminder offsets', () => {
    const r = parseQuickAdd('Review PRs today at 3pm for 1h30m remind me 15m before', { now, timezone: tz });
    expect(r.title).toBe('Review PRs');
    expect(r.durationMinutes).toBe(90);
    expect(r.reminderOffsets).toEqual([15]);
  });

  it('relative instants', () => {
    const r = parseQuickAdd('Check oven in 20 minutes', { now, timezone: tz });
    expect(local(r.dueAt)).toBe('Wed 2026-10-21 10:20');
    expect(local(parseQuickAdd('Renew passport in 2 weeks', { now, timezone: tz }).dueAt)).toBe('Wed 2026-11-04 00:00');
  });

  it('weekday recurrences without a time start today', () => {
    const r = parseQuickAdd('Water plants every weekday', { now, timezone: tz });
    expect(r.recurrence?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(local(r.dueAt)).toBe('Wed 2026-10-21 00:00');
    expect(r.allDay).toBe(true);
  });

  it('multiple weekdays and intervals', () => {
    expect(parseQuickAdd('Gym every mon, wed and fri at 7am', { now, timezone: tz }).recurrence?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(parseQuickAdd('Backup every 2 weeks', { now, timezone: tz }).recurrence?.rrule).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(parseQuickAdd('Invoice every 15th', { now, timezone: tz }).recurrence?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    const fc = parseQuickAdd('Change filter every 3 months after completion', { now, timezone: tz });
    expect(fc.recurrence).toEqual({ rrule: 'FREQ=MONTHLY;INTERVAL=3', mode: 'FROM_COMPLETION' });
    expect(fc.title).toBe('Change filter');
  });

  it('does not mangle words that contain date keywords', () => {
    const r = parseQuickAdd('Monitor satellite feed', { now, timezone: tz });
    expect(r.title).toBe('Monitor satellite feed');
    expect(r.dueAt).toBeNull();
  });

  it('next <weekday> never resolves to today', () => {
    expect(local(parseQuickAdd('Plan sprint next wednesday', { now, timezone: tz }).dueAt)).toBe('Wed 2026-10-28 00:00');
    expect(local(parseQuickAdd('Plan sprint wednesday', { now, timezone: tz }).dueAt)).toBe('Wed 2026-10-21 00:00');
  });

  it('numeric dates honour date order', () => {
    expect(local(parseQuickAdd('File taxes 03/04/2027', { now, timezone: tz }).dueAt)).toBe('Thu 2027-03-04 00:00');
    expect(local(parseQuickAdd('File taxes 03/04/2027', { now, timezone: tz, dateOrder: 'DMY' }).dueAt)).toBe('Sat 2027-04-03 00:00');
  });
});
