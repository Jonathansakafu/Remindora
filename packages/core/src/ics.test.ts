import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:one@x',
  'SUMMARY:Team sync\\, weekly',
  'DTSTART;TZID=America/New_York:20261026T100000',
  'DTEND;TZID=America/New_York:20261026T103000',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'EXDATE;TZID=America/New_York:20261102T100000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:two@x',
  'SUMMARY:Company holiday',
  'DTSTART;VALUE=DATE:20261126',
  'DTEND;VALUE=DATE:20261127',
  'LOCATION:Every',
  ' where',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:three@x',
  'STATUS:CANCELLED',
  'SUMMARY:Cancelled',
  'DTSTART:20261027T150000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ICS subscriptions', () => {
  const events = parseIcs(ICS, { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') }, 'UTC');

  it('expands recurrences, honours EXDATE and unescapes text', () => {
    const sync = events.filter((e) => e.uid === 'one@x');
    expect(sync.map((e) => e.startAt.toISOString())).toEqual(['2026-10-26T14:00:00.000Z', '2026-11-09T15:00:00.000Z']);
    expect(sync[0]!.title).toBe('Team sync, weekly');
    expect(sync[0]!.endAt.getTime() - sync[0]!.startAt.getTime()).toBe(30 * 60_000);
  });

  it('parses all-day events and unfolds lines; skips cancelled', () => {
    const holiday = events.find((e) => e.uid === 'two@x')!;
    expect(holiday.allDay).toBe(true);
    expect(holiday.location).toBe('Everywhere');
    expect(events.some((e) => e.uid === 'three@x')).toBe(false);
  });
});
