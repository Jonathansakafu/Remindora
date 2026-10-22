import { describe, expect, it } from 'vitest';
import { isRecentlyReauthenticated, requiresDeviceApproval, sessionState } from './sessions';

const now = new Date('2026-10-21T12:00:00Z');
const live = { revokedAt: null, expiresAt: new Date('2026-12-01T00:00:00Z'), lastActiveAt: new Date('2026-10-21T11:00:00Z') };

describe('device sessions', () => {
  it('is active until revoked', () => {
    expect(sessionState(live, { revokedAt: null }, now)).toBe('active');
  });

  it('revoking the device revokes every session on it', () => {
    expect(sessionState(live, { revokedAt: new Date('2026-10-21T11:30:00Z') }, now)).toBe('revoked');
  });

  it('revoking the session itself is immediate', () => {
    expect(sessionState({ ...live, revokedAt: now }, { revokedAt: null }, now)).toBe('revoked');
  });

  it('expires on absolute expiry and on idle timeout', () => {
    expect(sessionState({ ...live, expiresAt: now }, null, now)).toBe('expired');
    expect(sessionState({ ...live, lastActiveAt: new Date('2026-09-01T00:00:00Z') }, null, now)).toBe('idle');
  });

  it('re-auth window is five minutes', () => {
    const t = now.getTime();
    expect(isRecentlyReauthenticated(new Date(t - 4 * 60_000), t)).toBe(true);
    expect(isRecentlyReauthenticated(new Date(t - 6 * 60_000), t)).toBe(false);
    expect(isRecentlyReauthenticated(Math.floor((t - 60_000) / 1000), t)).toBe(true);
    expect(isRecentlyReauthenticated(null, t)).toBe(false);
  });

  it('requires approval only when opted in and another device is recently active', () => {
    expect(requiresDeviceApproval({ requireApproval: true, activeDeviceLastSeen: [new Date('2026-10-20T00:00:00Z')], now })).toBe(true);
    expect(requiresDeviceApproval({ requireApproval: true, activeDeviceLastSeen: [new Date('2026-09-01T00:00:00Z')], now })).toBe(false);
    expect(requiresDeviceApproval({ requireApproval: false, activeDeviceLastSeen: [now], now })).toBe(false);
  });
});
