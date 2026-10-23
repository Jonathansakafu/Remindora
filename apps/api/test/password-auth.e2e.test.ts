import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DESKTOP, PHONE, signIn, startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const resetLink = (to: string) => {
  const mail = [...h.outbox].reverse().find((m) => m.to === to && /reset/i.test(m.subject));
  const m = mail?.text.match(/reset-password\?c=([0-9a-f-]+)&t=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no reset link mailed to ${to}`);
  return { challengeId: m[1]!, token: m[2]! };
};

describe('password accounts', () => {
  const email = `pw-${Date.now()}@example.com`;

  it('registers only after the emailed code is verified', async () => {
    const start = await h.http().post('/auth/register').send({ name: 'Pat Doe', email, password: 'Sunrise-42', device: DESKTOP }).expect(200);
    expect(await h.prisma.user.findUnique({ where: { email } })).toBeNull();
    const mail = [...h.outbox].reverse().find((m) => m.to === email)!;
    expect(mail.subject).toMatch(/confirm your email/i);
    const code = mail.text.match(/\b(\d{6})\b/)![1];
    const res = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code, pollSecret: start.body.pollSecret }).expect(200);
    expect(res.body.status).toBe('signed_in');
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe('Pat Doe');
    expect(user.passwordHash).toMatch(/^scrypt\$/);
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const weak = await h.http().post('/auth/register').send({ name: 'X', email: `weak-${Date.now()}@example.com`, password: 'password', device: DESKTOP }).expect(400);
    expect(weak.body.error.code).toBe('weak_password');
    const dup = await h.http().post('/auth/register').send({ name: 'X', email, password: 'Another-77', device: DESKTOP }).expect(409);
    expect(dup.body.error.code).toBe('account_exists');
  });

  it('signs in with the password and rejects a wrong one', async () => {
    const ok = await h.http().post('/auth/password/login').send({ email, password: 'Sunrise-42', device: PHONE }).expect(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();
    expect(ok.body.tokens.refreshToken).toBeTruthy();
    const bad = await h.http().post('/auth/password/login').send({ email, password: 'Sunrise-43', device: PHONE }).expect(401);
    expect(bad.body.error.code).toBe('invalid_credentials');
    await h.http().post('/auth/password/login').send({ email: `nobody-${Date.now()}@example.com`, password: 'Sunrise-42', device: PHONE }).expect(401);
  });

  it('web logins get the refresh token as a cookie, not in the body', async () => {
    const res = await h.http().post('/auth/password/login').send({ email, password: 'Sunrise-42', device: { name: 'Browser', platform: 'WEB' } }).expect(200);
    expect(res.body.tokens.refreshToken).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/rmd_rt=/);
  });

  it('resets a forgotten password, signs every device out, and the link works once', async () => {
    const before = await h.http().post('/auth/password/login').send({ email, password: 'Sunrise-42', device: PHONE }).expect(200);
    await h.http().post('/auth/password/forgot').send({ email }).expect(200);
    const { challengeId, token } = resetLink(email);

    await h.http().post('/auth/password/reset').send({ challengeId, token: token + 'x', password: 'Moonrise-88' }).expect(400);
    await h.http().post('/auth/password/reset').send({ challengeId, token, password: 'Moonrise-88' }).expect(200);
    await h.http().post('/auth/password/reset').send({ challengeId, token, password: 'Moonrise-99' }).expect(410);

    await h.http().post('/auth/refresh').send({ refreshToken: before.body.tokens.refreshToken }).set('x-remindora-csrf', '1').expect(401);
    await h.http().post('/auth/password/login').send({ email, password: 'Sunrise-42', device: PHONE }).expect(401);
    await h.http().post('/auth/password/login').send({ email, password: 'Moonrise-88', device: PHONE }).expect(200);
  });

  it('forgot-password answers the same for unknown emails and sends nothing', async () => {
    const ghost = `ghost-${Date.now()}@example.com`;
    const res = await h.http().post('/auth/password/forgot').send({ email: ghost }).expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(h.outbox.some((m) => m.to === ghost)).toBe(false);
  });

  it('code-only accounts can set a password through the reset flow', async () => {
    const codeOnly = `code-${Date.now()}@example.com`;
    await signIn(h, codeOnly);
    await h.http().post('/auth/password/login').send({ email: codeOnly, password: 'Whatever-11', device: PHONE }).expect(401);
    await h.http().post('/auth/password/forgot').send({ email: codeOnly }).expect(200);
    const { challengeId, token } = resetLink(codeOnly);
    await h.http().post('/auth/password/reset').send({ challengeId, token, password: 'Whatever-11' }).expect(200);
    await h.http().post('/auth/password/login').send({ email: codeOnly, password: 'Whatever-11', device: PHONE }).expect(200);
  });
});
