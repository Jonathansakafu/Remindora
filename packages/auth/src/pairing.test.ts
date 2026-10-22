import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimPairing, createPairingToken, openPairingToken, PAIRING_TTL_MS, verifyClaimSecret, type PairingRecord, type PairingStore } from './pairing';

const key = randomBytes(32);

function memoryStore(): PairingStore & { rows: Map<string, PairingRecord> } {
  const rows = new Map<string, PairingRecord>();
  return {
    rows,
    async find(id) {
      return rows.get(id) ?? null;
    },
    async transition(id, from, patch) {
      const row = rows.get(id);
      if (!row || row.status !== from) return false;
      rows.set(id, { ...row, ...patch });
      return true;
    },
  };
}

function seed(store: ReturnType<typeof memoryStore>, now: number) {
  const { token, secretHash, expiresAt } = createPairingToken(key, 'pair-1', now);
  store.rows.set('pair-1', { id: 'pair-1', userId: 'user-1', secretHash, status: 'PENDING', expiresAt, claimSecretHash: null, claimExpiresAt: null, verificationCode: null });
  return token;
}

describe('QR pairing tokens', () => {
  it('expire after 60 seconds', () => {
    const now = Date.now();
    const { token, expiresAt } = createPairingToken(key, 'p', now);
    expect(expiresAt.getTime() - now).toBe(PAIRING_TTL_MS);
    expect(openPairingToken(key, token, now + 59_999).ok).toBe(true);
    expect(openPairingToken(key, token, now + 60_000)).toEqual({ ok: false, error: 'expired' });
  });

  it('carry no user data in clear text and reject tampering / wrong keys', () => {
    const { token } = createPairingToken(key, 'pairing-id-123');
    const raw = Buffer.from(token.slice(5), 'base64url').toString('latin1');
    expect(raw).not.toContain('pairing-id-123');
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect(openPairingToken(key, tampered).ok).toBe(false);
    expect(openPairingToken(randomBytes(32), token)).toEqual({ ok: false, error: 'invalid' });
    expect(openPairingToken(key, 'garbage')).toEqual({ ok: false, error: 'malformed' });
  });

  it('can be claimed exactly once, even under a race', async () => {
    const now = Date.now();
    const store = memoryStore();
    const token = seed(store, now);
    const results = await Promise.all([claimPairing(store, key, token, now + 1000), claimPairing(store, key, token, now + 1000)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0]).toEqual({ ok: false, error: 'already_used' });
    expect(await claimPairing(store, key, token, now + 2000)).toEqual({ ok: false, error: 'already_used' });
    expect(store.rows.get('pair-1')!.status).toBe('CLAIMED');
  });

  it('cannot be claimed after expiry', async () => {
    const now = Date.now();
    const store = memoryStore();
    const token = seed(store, now);
    expect(await claimPairing(store, key, token, now + PAIRING_TTL_MS + 1)).toEqual({ ok: false, error: 'expired' });
    expect(store.rows.get('pair-1')!.status).toBe('PENDING');
  });

  it('rejects a token whose secret does not match the stored hash', async () => {
    const now = Date.now();
    const store = memoryStore();
    seed(store, now);
    const forged = createPairingToken(key, 'pair-1', now).token; // same id, different secret
    expect(await claimPairing(store, key, forged, now)).toEqual({ ok: false, error: 'invalid' });
  });

  it('claim secrets verify and expire', async () => {
    const now = Date.now();
    const store = memoryStore();
    const token = seed(store, now);
    const claim = await claimPairing(store, key, token, now);
    if (!claim.ok) throw new Error('claim failed');
    const rec = store.rows.get('pair-1')!;
    expect(verifyClaimSecret(rec, claim.claimSecret, now)).toBe('ok');
    expect(verifyClaimSecret(rec, 'wrong', now)).toBe('invalid');
    expect(verifyClaimSecret(rec, claim.claimSecret, now + 10 * 60_000)).toBe('expired');
    expect(claim.verificationCode).toMatch(/^\d{4}$/);
  });
});
