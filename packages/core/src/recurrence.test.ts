import { describe, expect, it } from 'vitest';
import { describeRRule, nextOccurrence, occurrencesBetween, validateRRule } from './recurrence';

const NY = 'America/New_York';

describe('recurrence', () => {
  it('keeps wall-clock time across a DST change (every Friday at 4pm)', () => {
    // Fri 30 Oct 2026 16:00 EDT (UTC-4) → Fri 6 Nov 2026 16:00 EST (UTC-5)
    const dtstart = new Date('2026-10-30T20:00:00Z');
    const next = nextOccurrence({ rrule: 'FREQ=WEEKLY;BYDAY=FR', dtstart, timezone: NY }, dtstart);
    expect(next?.toISOString()).toBe('2026-11-06T21:00:00.000Z');
  });

  it('accepts an RRULE: prefix and ignores embedded DTSTART', () => {
    const dtstart = new Date('2026-01-05T09:00:00Z');
    const next = nextOccurrence({ rrule: 'DTSTART:20200101T000000Z\nRRULE:FREQ=DAILY;INTERVAL=2', dtstart, timezone: 'UTC' }, dtstart);
    expect(next?.toISOString()).toBe('2026-01-07T09:00:00.000Z');
  });

  it('honours UNTIL and COUNT', () => {
    const dtstart = new Date('2026-03-01T12:00:00Z');
    const spec = { rrule: 'FREQ=DAILY;COUNT=3', dtstart, timezone: 'UTC' };
    expect(nextOccurrence(spec, new Date('2026-03-02T12:00:00Z'))?.toISOString()).toBe('2026-03-03T12:00:00.000Z');
    expect(nextOccurrence(spec, new Date('2026-03-03T12:00:00Z'))).toBeNull();
    const untilSpec = { rrule: 'FREQ=DAILY', dtstart, timezone: 'UTC', until: new Date('2026-03-02T23:00:00Z') };
    expect(nextOccurrence(untilSpec, new Date('2026-03-02T12:00:00Z'))).toBeNull();
  });

  it('monthly on the 31st skips short months', () => {
    const dtstart = new Date('2026-01-31T15:00:00Z');
    const next = nextOccurrence({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', dtstart, timezone: 'UTC' }, dtstart);
    expect(next?.toISOString()).toBe('2026-03-31T15:00:00.000Z');
  });

  it('FROM_COMPLETION schedules relative to completion, keeping time of day', () => {
    const dtstart = new Date('2026-10-01T13:00:00Z'); // 09:00 EDT
    const completedAt = new Date('2026-10-10T22:30:00Z'); // 18:30 EDT on the 10th
    const next = nextOccurrence({ rrule: 'FREQ=DAILY;INTERVAL=3', dtstart, timezone: NY, mode: 'FROM_COMPLETION' }, dtstart, completedAt);
    expect(next?.toISOString()).toBe('2026-10-13T13:00:00.000Z');
  });

  it('projects occurrences into a calendar window', () => {
    const dtstart = new Date('2026-10-05T13:00:00Z'); // Mon 09:00 EDT
    const occ = occurrencesBetween({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', dtstart, timezone: NY }, new Date('2026-10-05T00:00:00Z'), new Date('2026-10-18T23:59:59Z'));
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-10-05T13:00:00.000Z',
      '2026-10-07T13:00:00.000Z',
      '2026-10-12T13:00:00.000Z',
      '2026-10-14T13:00:00.000Z',
    ]);
  });

  it('validates and describes rules', () => {
    expect(validateRRule('FREQ=WEEKLY;BYDAY=FR')).toBe(true);
    expect(validateRRule('nonsense')).toBe(false);
    expect(describeRRule('FREQ=WEEKLY;BYDAY=FR')).toMatch(/week.*friday/i);
  });
});
