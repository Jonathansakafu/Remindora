import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Cryptographic primitives. All secrets are 32-byte keys supplied as base64 or hex env vars. */

export function decodeKey(raw: string, name = 'key'): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes`);
  return buf;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(key: Buffer, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Six-digit numeric code, uniformly distributed. */
export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const ENC_VERSION = 'v1';

/**
 * AES-256-GCM envelope for secrets at rest (OAuth tokens, push tokens, integration
 * credentials). Format: v1.<iv>.<tag>.<ciphertext> (base64url). `aad` binds the
 * ciphertext to its context (e.g. the owning row id) so it can't be transplanted.
 */
export function encryptSecret(key: Buffer, plaintext: string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(key: Buffer, envelope: string, aad = ''): string {
  const [version, iv, tag, ct] = envelope.split('.');
  if (version !== ENC_VERSION || !iv || !tag || ct === undefined) throw new Error('Malformed encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
