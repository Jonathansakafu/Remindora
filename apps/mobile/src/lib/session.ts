import type { AuthTokensDTO, DeviceInfoInput, UserDTO } from '@remindora/types';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { API_URL, APP_VERSION } from './config';

const REFRESH_KEY = 'remindora.refresh';

/** Refresh token lives in Android Keystore-backed SecureStore; the access token only in memory. */
interface SessionState {
  status: 'loading' | 'signed_out' | 'signed_in';
  user: UserDTO | null;
  accessToken: string | null;
  expiresAt: number;
  sessionId: string | null;
  deviceId: string | null;
  accept: (t: AuthTokensDTO) => Promise<void>;
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
    if (t.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken);
    set({ status: 'signed_in', user: t.user, accessToken: t.accessToken, expiresAt: new Date(t.accessTokenExpiresAt).getTime(), sessionId: t.sessionId, deviceId: t.deviceId });
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    set({ status: 'signed_out', user: null, accessToken: null, expiresAt: 0, sessionId: null, deviceId: null });
  },
}));

export function deviceInfo(): DeviceInfoInput {
  return {
    name: Device.deviceName ?? `${Device.manufacturer ?? 'Android'} ${Device.modelName ?? 'phone'}`,
    platform: 'ANDROID',
    osVersion: `Android ${Device.osVersion ?? ''}`.trim(),
    appVersion: APP_VERSION,
  };
}

let inflight: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!res.ok) {
        if (res.status === 401) await useSession.getState().clear();
        return false;
      }
      await useSession.getState().accept((await res.json()) as AuthTokensDTO);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (inflight = null), 0);
    }
  })();
  return inflight;
}
