import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (memory-hard, built into Node). Stored as
 * `scrypt$N$r$p$salt$hash` so parameters can be raised later without breaking old hashes.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Returns a reason when the password is too weak, otherwise null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9\W_]/.test(password)) return 'Mix letters with numbers or symbols';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) return 'Don’t include your email name in the password';
  return null;
}
