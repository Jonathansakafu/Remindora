import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { randomToken, safeEqual, sha256, sixDigitCode } from './crypto';

/**
 * QR device pairing tokens.
 *
 * The QR carries `rmd1.<base64url(iv | tag | AES-256-GCM(payload))>` where the
 * payload is only { pid, sec, exp }: a pairing id, a random secret and an expiry.
 * No user data, passwords or session tokens are ever embedded. GCM authenticates
 * the payload, so a tampered or forged token fails to decrypt. The server stores
 * only sha256(sec), and single-use is enforced by an atomic PENDING → CLAIMED
 * transition in the store.
 */

export const PAIRING_TTL_MS = 60_000;
/** After a successful claim both sides have this long to confirm. */
export const PAIRING_CONFIRM_TTL_MS = 120_000;
const PREFIX = 'rmd1.';
const AAD = Buffer.from('remindora:pairing:v1');

export interface PairingPayload {
  pid: string;
  sec: string;
  exp: number;
}

export function createPairingToken(key: Buffer, pairingId: string, now = Date.now(), ttlMs = PAIRING_TTL_MS) {
  const secret = randomToken(24);
  const payload: PairingPayload = { pid: pairingId, sec: secret, exp: now + ttlMs };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const token = PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
  return { token, secretHash: sha256(secret), expiresAt: new Date(payload.exp) };
}

export type PairingTokenError = 'malformed' | 'invalid' | 'expired';

export function openPairingToken(key: Buffer, token: string, now = Date.now()): { ok: true; payload: PairingPayload } | { ok: false; error: PairingTokenError } {
  if (!token.startsWith(PREFIX)) return { ok: false, error: 'malformed' };
  let raw: Buffer;
  try {
    raw = Buffer.from(token.slice(PREFIX.length), 'base64url');
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (raw.length < 12 + 16 + 2) return { ok: false, error: 'malformed' };
  let payload: PairingPayload;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { ok: false, error: 'expired' };
  return { ok: true, payload };
}

/** Pairing record as persisted (DevicePairingToken). */
export interface PairingRecord {
  id: string;
  userId: string;
  secretHash: string;
  status: 'PENDING' | 'CLAIMED' | 'APPROVED' | 'CONSUMED' | 'REJECTED' | 'EXPIRED';
  expiresAt: Date;
  claimSecretHash: string | null;
  claimExpiresAt: Date | null;
  verificationCode: string | null;
}

/** Storage port. `transition` must be atomic (compare-and-set on status). */
export interface PairingStore {
  find(id: string): Promise<PairingRecord | null>;
  transition(id: string, from: PairingRecord['status'], patch: Partial<PairingRecord>): Promise<boolean>;
}

export type ClaimResult =
  | { ok: true; pairingId: string; userId: string; claimSecret: string; verificationCode: string; expiresAt: Date }
  | { ok: false; error: PairingTokenError | 'not_found' | 'already_used' };

/** Validates a scanned token and atomically claims it. A token can be claimed exactly once. */
export async function claimPairing(store: PairingStore, key: Buffer, token: string, now = Date.now()): Promise<ClaimResult> {
  const opened = openPairingToken(key, token, now);
  if (!opened.ok) return opened;
  const record = await store.find(opened.payload.pid);
  if (!record) return { ok: false, error: 'not_found' };
  if (!safeEqual(record.secretHash, sha256(opened.payload.sec))) return { ok: false, error: 'invalid' };
  if (record.expiresAt.getTime() <= now) return { ok: false, error: 'expired' };
  if (record.status !== 'PENDING') return { ok: false, error: 'already_used' };

  const claimSecret = randomToken(32);
  const verificationCode = sixDigitCode().slice(0, 4);
  const expiresAt = new Date(now + PAIRING_CONFIRM_TTL_MS);
  const won = await store.transition(record.id, 'PENDING', {
    status: 'CLAIMED',
    claimSecretHash: sha256(claimSecret),
    claimExpiresAt: expiresAt,
    verificationCode,
  });
  if (!won) return { ok: false, error: 'already_used' };
  return { ok: true, pairingId: record.id, userId: record.userId, claimSecret, verificationCode, expiresAt };
}

/** Checks the claimant's secret for status polling / completion. */
export function verifyClaimSecret(record: PairingRecord, claimSecret: string, now = Date.now()): 'ok' | 'invalid' | 'expired' {
  if (!record.claimSecretHash || !safeEqual(record.claimSecretHash, sha256(claimSecret))) return 'invalid';
  if (!record.claimExpiresAt || record.claimExpiresAt.getTime() <= now) return 'expired';
  return 'ok';
}
