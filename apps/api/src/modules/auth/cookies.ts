import { REFRESH_TOKEN_TTL_DAYS } from '@remindora/auth';
import { corsOrigins } from '@remindora/config';
import type { Request, Response } from 'express';
import { Errors } from '../../common/errors';
import type { ServerEnv } from '../../config';

/**
 * Web refresh-token cookie. httpOnly (no JS access), SameSite=Lax, path-scoped
 * to /auth so it's only sent to auth endpoints.
 *
 * CSRF: cookie-authenticated endpoints additionally require a custom header
 * (which forces a CORS preflight that only allowlisted origins pass) and, when
 * the browser sends one, an allowlisted Origin.
 */
export const REFRESH_COOKIE = 'rmd_rt';
export const CSRF_HEADER = 'x-remindora-csrf';

export function setRefreshCookie(res: Response, token: string, env: ServerEnv) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/auth',
    domain: env.COOKIE_DOMAIN,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response, env: ServerEnv) {
  res.clearCookie(REFRESH_COOKIE, { path: '/auth', domain: env.COOKIE_DOMAIN, secure: env.COOKIE_SECURE, sameSite: 'lax', httpOnly: true });
}

export function readRefreshCookie(req: Request): string | undefined {
  const v = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function requireCsrfHeader(req: Request, env: ServerEnv) {
  if (req.headers[CSRF_HEADER] !== '1') throw Errors.forbidden('Missing CSRF header');
  const origin = req.headers.origin;
  if (origin && !corsOrigins(env).includes(origin) && origin !== env.WEB_URL) throw Errors.forbidden('Origin not allowed');
}
