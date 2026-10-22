import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  /** Unix seconds of last re-auth, if any. */
  reauthAt: number | null;
}

export type AuthedRequest = Request & { auth: AuthContext };

export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export function userAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 300) : null;
}
