import { describe, expect, it } from 'vitest';
import { checkLimit, effectivePlan, hasFeature, resolveEntitlements, rolloutBucket } from './evaluate';

describe('premium entitlements', () => {
  it('free plan limits match the published plan', () => {
    const e = resolveEntitlements({ userId: 'u', plan: 'FREE', rows: [], flags: [] });
    expect(e.limits).toMatchObject({
      'lists.max': 9,
      'tasksPerList.max': 99,
      'attachmentsPerDay.max': 1,
      'checklistItemsPerTask.max': 19,
      'remindersPerTask.max': 2,
      'members.max': 2,
      'habits.max': 5,
      'countdowns.max': 5,
    });
    expect(hasFeature(e, 'view.kanban')).toBe(true);
    expect(hasFeature(e, 'view.timeline')).toBe(false);
    expect(hasFeature(e, 'reminders.email')).toBe(false);
    expect(hasFeature(e, 'ai')).toBe(false);
  });

  it('premium plan limits and features', () => {
    const e = resolveEntitlements({ userId: 'u', plan: 'PREMIUM', rows: [], flags: [] });
    expect(e.limits).toMatchObject({ 'lists.max': 299, 'tasksPerList.max': 999, 'attachmentsPerDay.max': 199, 'checklistItemsPerTask.max': 199, 'remindersPerTask.max': 5, 'members.max': 29, 'habits.max': 299, 'countdowns.max': 299 });
    for (const f of ['view.timeline', 'task.duration', 'reminders.email', 'reminders.constant', 'reminders.checklist', 'templates.custom', 'history.full', 'filters.advanced', 'ai', 'stats.premium'] as const) {
      expect(hasFeature(e, f)).toBe(true);
    }
  });

  it('enforces limits at the boundary', () => {
    const e = resolveEntitlements({ userId: 'u', plan: 'FREE', rows: [], flags: [] });
    expect(checkLimit(e, 'lists.max', 8)).toMatchObject({ ok: true, remaining: 0 });
    expect(checkLimit(e, 'lists.max', 9)).toMatchObject({ ok: false, limit: 9 });
    expect(checkLimit(e, 'remindersPerTask.max', 0, 3).ok).toBe(false);
  });

  it('database rows change limits without an app update; per-user rows win', () => {
    const e = resolveEntitlements({
      userId: 'u',
      plan: 'FREE',
      rows: [
        { plan: 'FREE', userId: null, key: 'lists.max', limit: 12, enabled: null },
        { plan: 'PREMIUM', userId: null, key: 'lists.max', limit: 1000, enabled: null },
        { plan: null, userId: 'u', key: 'habits.max', limit: 50, enabled: null },
        { plan: null, userId: 'u', key: 'view.timeline', limit: null, enabled: true },
        { plan: null, userId: 'someone-else', key: 'ai', limit: null, enabled: true },
      ],
      flags: [],
    });
    expect(e.limits['lists.max']).toBe(12);
    expect(e.limits['habits.max']).toBe(50);
    expect(hasFeature(e, 'view.timeline')).toBe(true);
    expect(hasFeature(e, 'ai')).toBe(false);
  });

  it('feature flags act as global kill switches and staged rollouts', () => {
    const off = resolveEntitlements({ userId: 'u', plan: 'PREMIUM', rows: [], flags: [{ key: 'ai', enabled: false, rolloutPercent: 100, plans: [], allowUserIds: [] }] });
    expect(hasFeature(off, 'ai')).toBe(false);
    const allow = resolveEntitlements({ userId: 'u', plan: 'PREMIUM', rows: [], flags: [{ key: 'ai', enabled: false, rolloutPercent: 0, plans: [], allowUserIds: ['u'] }] });
    expect(hasFeature(allow, 'ai')).toBe(true);
    const half = { key: 'ai', enabled: true, rolloutPercent: 50, plans: [], allowUserIds: [] };
    const users = Array.from({ length: 400 }, (_, i) => `user-${i}`);
    const on = users.filter((id) => hasFeature(resolveEntitlements({ userId: id, plan: 'PREMIUM', rows: [], flags: [half] }), 'ai')).length;
    expect(on).toBeGreaterThan(150);
    expect(on).toBeLessThan(250);
    expect(rolloutBucket('ai', 'user-1')).toBe(rolloutBucket('ai', 'user-1'));
  });

  it('subscription status decides the effective plan', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    const future = new Date('2026-11-21T00:00:00Z');
    const past = new Date('2026-10-01T00:00:00Z');
    expect(effectivePlan(null, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'ACTIVE', currentPeriodEnd: future }, now)).toBe('PREMIUM');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'CANCELED', currentPeriodEnd: future }, now)).toBe('PREMIUM');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'CANCELED', currentPeriodEnd: past }, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'PAST_DUE', currentPeriodEnd: new Date('2026-10-18T00:00:00Z') }, now)).toBe('PREMIUM');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'PAST_DUE', currentPeriodEnd: past }, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'PREMIUM', status: 'EXPIRED', currentPeriodEnd: future }, now)).toBe('FREE');
  });
});
