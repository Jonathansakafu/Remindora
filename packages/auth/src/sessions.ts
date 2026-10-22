/** Session and device validity rules shared by the API guard and tests. */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 60;
/** Sessions unused for this long are treated as expired even if not revoked. */
export const SESSION_IDLE_TIMEOUT_DAYS = 30;
/** Window in which a sensitive action (device linking) counts as recently re-authenticated. */
export const REAUTH_WINDOW_SECONDS = 5 * 60;
export const EMAIL_CHALLENGE_TTL_MS = 10 * 60_000;
export const EMAIL_CHALLENGE_MAX_ATTEMPTS = 5;

export interface SessionLike {
  revokedAt: Date | null;
  expiresAt: Date;
  lastActiveAt: Date;
}

export interface DeviceLike {
  revokedAt: Date | null;
}

export type SessionState = 'active' | 'revoked' | 'expired' | 'idle';

export function sessionState(session: SessionLike, device: DeviceLike | null, now = new Date()): SessionState {
  if (session.revokedAt || device?.revokedAt) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (now.getTime() - session.lastActiveAt.getTime() > SESSION_IDLE_TIMEOUT_DAYS * 86_400_000) return 'idle';
  return 'active';
}

export function isRecentlyReauthenticated(reauthAt: number | Date | null | undefined, now = Date.now()): boolean {
  if (!reauthAt) return false;
  const ts = typeof reauthAt === 'number' ? reauthAt * 1000 : reauthAt.getTime();
  return now - ts <= REAUTH_WINDOW_SECONDS * 1000 && ts <= now + 5_000;
}

/**
 * A new email sign-in is "sensitive" — and needs approval from an existing
 * signed-in device — when the user opted in and has a device active recently.
 * Users with no recently active device fall back to email-only verification so
 * they can't be locked out.
 */
export function requiresDeviceApproval(opts: { requireApproval: boolean; activeDeviceLastSeen: Date[]; now?: Date }): boolean {
  if (!opts.requireApproval) return false;
  const now = (opts.now ?? new Date()).getTime();
  return opts.activeDeviceLastSeen.some((d) => now - d.getTime() < 14 * 86_400_000);
}
