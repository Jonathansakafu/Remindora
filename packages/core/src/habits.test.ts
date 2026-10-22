import { describe, expect, it } from 'vitest';
import { computeStreaks } from './habits';

describe('habit streaks', () => {
  const daily = { frequency: 'DAILY' as const, weekdays: [], targetPerPeriod: 1 };

  it('counts consecutive days and does not break on an unchecked today', () => {
    const r = computeStreaks(daily, ['2026-10-18', '2026-10-19', '2026-10-20'], '2026-10-21');
    expect(r.current).toBe(3);
    expect(r.best).toBe(3);
  });

  it('a missed day resets the current streak but keeps the best', () => {
    const r = computeStreaks(daily, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-20', '2026-10-21'], '2026-10-21');
    expect(r.current).toBe(2);
    expect(r.best).toBe(4);
  });

  it('unscheduled weekdays neither break nor extend', () => {
    const weekdaysOnly = { frequency: 'DAILY' as const, weekdays: [1, 2, 3, 4, 5], targetPerPeriod: 1 };
    // Thu 15, Fri 16, (weekend), Mon 19, Tue 20
    const r = computeStreaks(weekdaysOnly, ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'], '2026-10-21');
    expect(r.current).toBe(4);
  });

  it('weekly habits count weeks meeting the target', () => {
    const weekly = { frequency: 'WEEKLY' as const, weekdays: [], targetPerPeriod: 2 };
    const r = computeStreaks(weekly, ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19'], '2026-10-21');
    expect(r.current).toBe(2); // current week has 1/2 so far; previous two weeks met
  });
});
