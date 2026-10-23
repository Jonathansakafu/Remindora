import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse 9');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse 9', stored)).toBe(true);
    expect(await verifyPassword('correct horse 8', stored)).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same-pass-1')).not.toBe(await hashPassword('same-pass-1'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
  });
});

describe('passwordProblem', () => {
  it('flags weak passwords', () => {
    expect(passwordProblem('short1')).toMatch(/at least/);
    expect(passwordProblem('onlyletters')).toMatch(/Mix/);
    expect(passwordProblem('jonathan123', 'jonathan@example.com')).toMatch(/email/);
    expect(passwordProblem('Sunrise-42')).toBeNull();
  });
});
