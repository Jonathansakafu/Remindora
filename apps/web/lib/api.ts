'use client';
import { API_URL } from './config';
import { refreshSession, useSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get isPlanGate() {
    return this.status === 402;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function qs(query?: Query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** JSON API client: bearer auth, one transparent refresh on expiry, typed errors. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal; auth?: boolean } = {}): Promise<T> {
  const doFetch = async () => {
    const { accessToken, expiresAt } = useSession.getState();
    if (init.auth !== false && accessToken && expiresAt - Date.now() < 30_000) await refreshSession();
    const token = useSession.getState().accessToken;
    return fetch(`${API_URL}${path}${qs(init.query)}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      signal: init.signal,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };

  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && init.auth !== false) {
      const body = await res.clone().json().catch(() => ({}));
      if (body?.error?.code === 'invalid_token' && (await refreshSession())) res = await doFetch();
      else if (body?.error?.code === 'session_revoked') await useSession.getState().clear();
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'You appear to be offline');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}
