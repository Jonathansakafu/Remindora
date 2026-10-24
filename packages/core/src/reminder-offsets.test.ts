import { describe, expect, it } from 'vitest';
import { countdownLabel, customOffset, offsetLabel } from './reminder-offsets';

describe('reminder offsets', () => {
  it('labels presets and custom offsets', () => {
    expect(offsetLabel(0)).toBe('On time');
    expect(offsetLabel(1440)).toBe('1 day early');
    expect(offsetLabel(3 * 1440 + 15)).toBe('3 days 15 min early');
    expect(offsetLabel(75)).toBe('1 h 15 min early');
  });
  it('converts custom amounts and rejects nonsense', () => {
    expect(customOffset(2, 'days')).toBe(2880);
    expect(customOffset(90, 'minutes')).toBe(90);
    expect(customOffset(0, 'hours')).toBeNull();
    expect(customOffset(40, 'days')).toBeNull();
  });
  it('counts down', () => {
    const now = new Date('2026-10-24T10:00:00Z');
    expect(countdownLabel(new Date('2026-10-24T12:15:00Z'), now)).toBe('in 2 h 15 min');
    expect(countdownLabel(new Date('2026-10-27T10:00:00Z'), now)).toBe('in 3 days');
    expect(countdownLabel(new Date('2026-10-25T13:00:00Z'), now)).toBe('in 1 day 3 h');
    expect(countdownLabel(new Date('2026-10-24T09:55:00Z'), now)).toBe('5 min ago');
    expect(countdownLabel(new Date('2026-10-24T10:00:20Z'), now)).toBe('now');
  });
});
