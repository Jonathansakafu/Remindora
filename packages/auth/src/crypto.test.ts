import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, sixDigitCode } from './crypto';
import { signAccessToken, verifyAccessToken } from './jwt';

describe('secrets at rest', () => {
  const key = randomBytes(32);
  it('round-trips and binds to AAD', () => {
    const enc = encryptSecret(key, 'ya29.oauth-token', 'account:1');
    expect(enc).not.toContain('ya29');
    expect(decryptSecret(key, enc, 'account:1')).toBe('ya29.oauth-token');
    expect(() => decryptSecret(key, enc, 'account:2')).toThrow();
  });
  it('codes are six digits', () => {
    for (let i = 0; i < 50; i++) expect(sixDigitCode()).toMatch(/^\d{6}$/);
  });
});

describe('access tokens', () => {
  const secret = randomBytes(32);
  it('verify, expire and reject forgeries', () => {
    const now = Date.now();
    const { token } = signAccessToken(secret, { sub: 'u', sid: 's', did: 'd' }, 60, now);
    expect(verifyAccessToken(secret, token, now).sid).toBe('s');
    expect(() => verifyAccessToken(secret, token, now + 61_000)).toThrow(/expired/);
    expect(() => verifyAccessToken(randomBytes(32), token, now)).toThrow(/signature/);
  });
});
