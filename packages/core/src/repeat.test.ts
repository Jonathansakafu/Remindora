import { describe, expect, it } from 'vitest';
import { repeatFromRrule, repeatLabel, rruleFor } from './repeat';

describe('reminder repeat choices', () => {
  it('round-trips every choice through its rrule', () => {
    for (const v of ['none', 'daily', 'weekdays', 'weekly', 'monthly'] as const) expect(repeatFromRrule(rruleFor(v))).toBe(v);
  });
  it('labels known rules and ignores custom ones', () => {
    expect(repeatLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Weekdays (Mon–Fri)');
    expect(repeatLabel(null)).toBeNull();
    expect(repeatFromRrule('FREQ=YEARLY')).toBe('none');
  });
});
