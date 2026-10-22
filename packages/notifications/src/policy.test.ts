import { describe, expect, it } from 'vitest';
import { applyDeliveryWindow, applyReminderAction, decideChannels, deliveryKey, digestDue, initialFireAt, nextRealertAt, resolvePrefs } from './policy';

const prefs = resolvePrefs({ timezone: 'Europe/London' });
const t0 = new Date('2026-10-21T10:00:00Z'); // Wed 11:00 BST

describe('channel selection by priority', () => {
  it('critical → push + desktop + web push, email only when opted in', () => {
    expect(decideChannels('CRITICAL', prefs).channels).toEqual(['IN_APP', 'PUSH', 'DESKTOP', 'WEB_PUSH']);
    const withEmail = resolvePrefs({ criticalEmail: true, channels: { push: true, desktop: true, webPush: true, email: true, inApp: true } });
    expect(decideChannels('CRITICAL', withEmail).channels).toContain('EMAIL');
    expect(decideChannels('CRITICAL', withEmail, { emailEntitled: false }).channels).not.toContain('EMAIL');
    expect(decideChannels('HIGH', withEmail).channels).not.toContain('EMAIL');
  });

  it('low/none are silent in-app items, or digest-only', () => {
    expect(decideChannels('LOW', prefs)).toMatchObject({ channels: ['IN_APP'], silent: true, deliver: true });
    expect(decideChannels('NONE', resolvePrefs({ lowPriorityMode: 'digest' }))).toMatchObject({ deliver: false });
  });

  it('respects disabled channels and muted projects', () => {
    const noPush = resolvePrefs({ channels: { push: false, desktop: true, webPush: false, email: false, inApp: true } });
    expect(decideChannels('HIGH', noPush).channels).toEqual(['IN_APP', 'DESKTOP']);
    const muted = resolvePrefs({}, { muted: true });
    expect(decideChannels('CRITICAL', muted)).toMatchObject({ channels: ['IN_APP'], silent: true });
  });

  it('project overrides replace intervals and channels', () => {
    const p = resolvePrefs({ criticalRepeatMinutes: 30 }, { muted: false, criticalRepeatMinutes: 10, channels: { desktop: false } });
    expect(p.criticalRepeatMinutes).toBe(10);
    expect(decideChannels('CRITICAL', p).channels).not.toContain('DESKTOP');
  });
});

describe('re-alert schedule', () => {
  it('critical defaults to every 30 minutes', () => {
    expect(nextRealertAt({ priority: 'CRITICAL', attempt: 0 }, prefs, t0)?.toISOString()).toBe('2026-10-21T10:30:00.000Z');
  });

  it('high defaults to every 2 hours, intervals are user-configurable', () => {
    expect(nextRealertAt({ priority: 'HIGH', attempt: 0 }, prefs, t0)?.toISOString()).toBe('2026-10-21T12:00:00.000Z');
    const custom = resolvePrefs({ highRepeatMinutes: 45 });
    expect(nextRealertAt({ priority: 'HIGH', attempt: 0 }, custom, t0)?.toISOString()).toBe('2026-10-21T10:45:00.000Z');
  });

  it('stops after the maximum re-alert count', () => {
    const p = resolvePrefs({ maxRealerts: 3 });
    expect(nextRealertAt({ priority: 'CRITICAL', attempt: 2 }, p, t0)).not.toBeNull();
    expect(nextRealertAt({ priority: 'CRITICAL', attempt: 3 }, p, t0)).toBeNull();
    expect(nextRealertAt({ priority: 'CRITICAL', attempt: 0 }, resolvePrefs({ maxRealerts: 0 }), t0)).toBeNull();
  });

  it('medium sends one alert plus an optional single follow-up', () => {
    expect(nextRealertAt({ priority: 'MEDIUM', attempt: 0 }, prefs, t0)).toBeNull();
    const fu = resolvePrefs({ mediumFollowUpMinutes: 60 });
    expect(nextRealertAt({ priority: 'MEDIUM', attempt: 0 }, fu, t0)?.toISOString()).toBe('2026-10-21T11:00:00.000Z');
    expect(nextRealertAt({ priority: 'MEDIUM', attempt: 1 }, fu, t0)).toBeNull();
  });

  it('low never repeats; constant reminders upgrade low priority to repeating', () => {
    expect(nextRealertAt({ priority: 'LOW', attempt: 0 }, prefs, t0)).toBeNull();
    expect(nextRealertAt({ priority: 'LOW', attempt: 0, constant: true }, prefs, t0)?.toISOString()).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('quiet hours, weekends, timezones', () => {
  const quiet = resolvePrefs({ timezone: 'America/New_York', quietHoursEnabled: true, quietStart: '22:00', quietEnd: '07:00' });

  it('defers alerts falling in overnight quiet hours to the end of the window', () => {
    // 23:30 EDT → 07:00 EDT next day
    const at = new Date('2026-10-22T03:30:00Z');
    expect(applyDeliveryWindow(at, quiet, 'HIGH').toISOString()).toBe('2026-10-22T11:00:00.000Z');
  });

  it('critical bypasses quiet hours only when allowed', () => {
    const at = new Date('2026-10-22T03:30:00Z');
    expect(applyDeliveryWindow(at, quiet, 'CRITICAL').toISOString()).toBe('2026-10-22T11:00:00.000Z');
    expect(applyDeliveryWindow(at, { ...quiet, criticalBypassQuietHours: true }, 'CRITICAL')).toEqual(at);
  });

  it('skips weekends when disabled', () => {
    const noWeekends = resolvePrefs({ timezone: 'UTC', weekendsEnabled: false });
    const sat = new Date('2026-10-24T15:00:00Z');
    expect(applyDeliveryWindow(sat, noWeekends, 'HIGH').toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });

  it('all-day tasks alert at the morning digest time in the user timezone', () => {
    const due = new Date('2026-10-23T04:00:00Z'); // local midnight EDT
    const at = initialFireAt({ at: null, offsetMinutes: 0 }, { dueAt: due, allDay: true }, resolvePrefs({ timezone: 'America/New_York' }), 'HIGH');
    expect(at?.toISOString()).toBe('2026-10-23T12:00:00.000Z'); // 08:00 EDT
  });
});

describe('actions and safeguards', () => {
  it('snooze, acknowledge, complete and stop end or defer re-alerts', () => {
    expect(applyReminderAction('snooze', { now: t0, snoozeMinutes: 15 })).toMatchObject({ state: 'SNOOZED', nextFireAt: new Date('2026-10-21T10:15:00Z') });
    expect(applyReminderAction('acknowledge', { now: t0 })).toMatchObject({ state: 'ACKNOWLEDGED', nextFireAt: null });
    expect(applyReminderAction('complete', { now: t0 })).toMatchObject({ state: 'DONE', nextFireAt: null });
    expect(applyReminderAction('stop', { now: t0 })).toMatchObject({ state: 'STOPPED', nextFireAt: null });
  });

  it('delivery keys are stable per occurrence and attempt', () => {
    expect(deliveryKey('r1', t0, 2)).toBe(deliveryKey('r1', t0.toISOString(), 2));
    expect(deliveryKey('r1', t0, 2)).not.toBe(deliveryKey('r1', t0, 3));
  });

  it('digests fire once per local day after the configured time', () => {
    const p = resolvePrefs({ timezone: 'Asia/Tokyo', morningDigestTime: '08:00' });
    const at0805 = new Date('2026-10-21T23:05:00Z'); // 08:05 JST on the 22nd
    expect(digestDue('morning', p, null, at0805)).toBe(true);
    expect(digestDue('morning', p, '2026-10-22', at0805)).toBe(false);
    expect(digestDue('morning', p, null, new Date('2026-10-21T22:55:00Z'))).toBe(false);
    expect(digestDue('morning', p, null, new Date('2026-10-22T05:00:00Z'))).toBe(false); // 14:00, past grace
    expect(digestDue('evening', p, null, at0805)).toBe(false);
  });
});
