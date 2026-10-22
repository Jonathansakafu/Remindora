import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

/** Minimal HS256 JWT for short-lived access tokens. Revocation is enforced by session lookup, not expiry alone. */

export interface AccessClaims {
  sub: string;
  sid: string;
  did: string;
  iat: number;
  exp: number;
  /** Unix seconds of the last re-authentication (email code, biometric-backed native confirm). */
  rat?: number;
  typ: 'access';
}

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signAccessToken(secret: Buffer, claims: Omit<AccessClaims, 'iat' | 'exp' | 'typ'>, ttlSeconds: number, now = Date.now()): { token: string; expiresAt: Date } {
  const iat = Math.floor(now / 1000);
  const payload: AccessClaims = { ...claims, iat, exp: iat + ttlSeconds, typ: 'access' };
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return { token: `${head}.${body}.${sig}`, expiresAt: new Date(payload.exp * 1000) };
}

export class TokenError extends Error {}

export function verifyAccessToken(secret: Buffer, token: string, now = Date.now()): AccessClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Malformed token');
  const [head, body, sig] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(head, 'base64url').toString());
  if (header.alg !== 'HS256') throw new TokenError('Unsupported algorithm');
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  if (!safeEqual(expected, sig)) throw new TokenError('Bad signature');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessClaims;
  if (claims.typ !== 'access') throw new TokenError('Wrong token type');
  if (claims.exp * 1000 <= now) throw new TokenError('Token expired');
  return claims;
}
