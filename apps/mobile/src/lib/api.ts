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
  get isNetwork() {
    return this.status === 0;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const run = async () => {
    const s = useSession.getState();
    if (init.auth !== false && s.accessToken && s.expiresAt - Date.now() < 30_000) await refreshSession();
    const token = useSession.getState().accessToken;
    return fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };
  let res: Response;
  try {
    res = await run();
    if (res.status === 401 && init.auth !== false) {
      const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: string } };
      if (body.error?.code === 'invalid_token' && (await refreshSession())) res = await run();
      else if (body.error?.code === 'session_revoked') await useSession.getState().clear();
    }
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}
