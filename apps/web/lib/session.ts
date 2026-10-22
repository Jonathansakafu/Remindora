'use client';
import type { AuthTokensDTO, UserDTO } from '@remindora/types';
import { create } from 'zustand';
import { AUTH_URL } from './config';
import { isTauri, secureStore } from './platform';

const REFRESH_KEY = 'remindora.refresh';

interface SessionState {
  status: 'loading' | 'signed_out' | 'signed_in';
  user: UserDTO | null;
  accessToken: string | null;
  expiresAt: number;
  sessionId: string | null;
  deviceId: string | null;
  /** Access token is kept in memory only; the refresh token lives in an httpOnly cookie (web) or the OS keychain (desktop). */
  accept: (t: AuthTokensDTO | Omit<AuthTokensDTO, 'refreshToken'>) => Promise<void>;
  setUser: (u: UserDTO) => void;
  clear: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  expiresAt: 0,
  sessionId: null,
  deviceId: null,
  accept: async (t) => {
    if ('refreshToken' in t && t.refreshToken) await secureStore.set(REFRESH_KEY, t.refreshToken);
    set({ status: 'signed_in', user: t.user, accessToken: t.accessToken, expiresAt: new Date(t.accessTokenExpiresAt).getTime(), sessionId: t.sessionId, deviceId: t.deviceId });
  },
  setUser: (user) => set({ user }),
  clear: async () => {
    await secureStore.remove(REFRESH_KEY);
    set({ status: 'signed_out', user: null, accessToken: null, expiresAt: 0, sessionId: null, deviceId: null });
  },
}));

let inflight: Promise<boolean> | null = null;

/** Exchanges the refresh credential for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const native = isTauri();
      const refreshToken = native ? await secureStore.get(REFRESH_KEY) : null;
      if (native && !refreshToken) return false;
      const res = await fetch(`${AUTH_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-remindora-csrf': '1' },
        body: JSON.stringify(native ? { refreshToken } : {}),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) await useSession.getState().clear();
        return false;
      }
      await useSession.getState().accept(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (inflight = null), 0);
    }
  })();
  return inflight;
}
