import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, connectSocket, DESKTOP, lastCode, nextEvent, PHONE, signIn, startHarness, uniqueEmail, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

describe('email sign-in', () => {
  it('signs in with a six-digit code, creating a personal workspace with an Inbox', async () => {
    const email = uniqueEmail('new');
    const tokens = await signIn(h, email);
    expect(tokens.user.email).toBe(email);
    const ws = await h.http().get('/workspaces').set(auth(tokens.accessToken)).expect(200);
    expect(ws.body).toHaveLength(1);
    expect(ws.body[0]).toMatchObject({ isPersonal: true, role: 'OWNER' });
    const inbox = await h.http().get('/tasks?view=inbox').set(auth(tokens.accessToken)).expect(200);
    expect(inbox.body).toEqual([]);
  });

  it('codes are single-use and attempt-limited; responses do not reveal account existence', async () => {
    const email = uniqueEmail('limits');
    const start = await h.http().post('/auth/email/start').send({ email, device: DESKTOP }).expect(200);
    expect(Object.keys(start.body).sort()).toEqual(['challengeId', 'expiresAt', 'pollSecret']);
    const ttl = new Date(start.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);

    const bad = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code: '000000', pollSecret: start.body.pollSecret });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_code');

    const code = lastCode(h, email);
    await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code, pollSecret: start.body.pollSecret }).expect(200);
    const replay = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code, pollSecret: start.body.pollSecret });
    expect(replay.status).toBe(410);
  });

  it('a code from another sign-in attempt (wrong poll secret) is rejected', async () => {
    const email = uniqueEmail('mismatch');
    const start = await h.http().post('/auth/email/start').send({ email, device: DESKTOP }).expect(200);
    const res = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code: lastCode(h, email), pollSecret: 'x'.repeat(32) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('challenge_mismatch');
  });

  it('magic link verifies on any device; only the requesting device redeems the session', async () => {
    const email = uniqueEmail('magic');
    const start = await h.http().post('/auth/email/start').send({ email, device: PHONE }).expect(200);
    const link = h.outbox.find((m) => m.to === email)!.text.match(/https?:\/\/\S+magic\?c=([\w-]+)&t=([\w-]+)/)!;
    const pending = await h.http().post(`/auth/email/challenges/${start.body.challengeId}/poll`).send({ pollSecret: start.body.pollSecret }).expect(200);
    expect(pending.body.status).toBe('pending');

    await h.http().post('/auth/email/magic').send({ challengeId: link[1], token: link[2] }).expect(200);
    const done = await h.http().post(`/auth/email/challenges/${start.body.challengeId}/poll`).send({ pollSecret: start.body.pollSecret }).expect(200);
    expect(done.body.status).toBe('signed_in');
    expect(done.body.tokens.refreshToken).toBeTruthy(); // native platform → body delivery
    const again = await h.http().post(`/auth/email/challenges/${start.body.challengeId}/poll`).send({ pollSecret: start.body.pollSecret }).expect(200);
    expect(again.body.status).toBe('consumed');
  });

  it('sensitive sign-ins wait for approval on an existing signed-in device', async () => {
    const email = uniqueEmail('approve');
    const first = await signIn(h, email, DESKTOP);
    await h.http().patch('/auth/me').set(auth(first.accessToken)).send({ requireDeviceApproval: true }).expect(200);
    const socket = await connectSocket(h, first.accessToken);
    const approvalAsked = nextEvent<{ challengeId: string; deviceName: string }>(socket, 'device.approval_requested');

    const start = await h.http().post('/auth/email/start').send({ email, device: PHONE }).expect(200);
    const verify = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code: lastCode(h, email), pollSecret: start.body.pollSecret }).expect(200);
    expect(verify.body.status).toBe('awaiting_approval');
    const asked = await approvalAsked;
    expect(asked).toMatchObject({ challengeId: start.body.challengeId, deviceName: PHONE.name });

    await h.http().post(`/auth/email/challenges/${start.body.challengeId}/decide`).set(auth(first.accessToken)).send({ approve: true }).expect(200);
    const poll = await h.http().post(`/auth/email/challenges/${start.body.challengeId}/poll`).send({ pollSecret: start.body.pollSecret }).expect(200);
    expect(poll.body.status).toBe('signed_in');
    socket.disconnect();
  });
});

describe('sessions and device revocation', () => {
  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const tokens = await signIn(h, uniqueEmail('rotate'), PHONE);
    const r1 = await h.http().post('/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(tokens.refreshToken);
    // Replay of the rotated-out token = theft signal.
    await h.http().post('/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
    await h.http().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    const me = await h.http().get('/auth/me').set(auth(r1.body.accessToken));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('session_revoked');
  });

  it('web refresh uses an httpOnly cookie and requires the CSRF header', async () => {
    const email = uniqueEmail('web');
    const start = await h.http().post('/auth/email/start').send({ email, device: { name: 'Chrome', platform: 'WEB' } }).expect(200);
    const res = await h.http().post('/auth/email/verify').send({ challengeId: start.body.challengeId, code: lastCode(h, email), pollSecret: start.body.pollSecret }).expect(200);
    expect(res.body.tokens.refreshToken).toBeUndefined();
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/rmd_rt=.+; .*HttpOnly/i);
    await h.http().post('/auth/refresh').set('Cookie', cookie.split(';')[0]!).send({}).expect(403);
    await h.http().post('/auth/refresh').set('Cookie', cookie.split(';')[0]!).set('x-remindora-csrf', '1').send({}).expect(200);
  });

  it('lists linked devices and revokes one remotely, effective immediately', async () => {
    const email = uniqueEmail('devices');
    const laptop = await signIn(h, email, DESKTOP);
    await h.http().patch('/auth/me').set(auth(laptop.accessToken)).send({ requireDeviceApproval: false }).expect(200);
    const phone = await signIn(h, email, PHONE);
    const list = await h.http().get('/devices').set(auth(laptop.accessToken)).expect(200);
    expect(list.body.map((d: { name: string }) => d.name).sort()).toEqual([PHONE.name, DESKTOP.name].sort());
    expect(list.body.find((d: { current: boolean }) => d.current).name).toBe(DESKTOP.name);
    expect(list.body[0]).toHaveProperty('lastActiveAt');
    expect(list.body[0]).toHaveProperty('platform');

    const phoneSocket = await connectSocket(h, phone.accessToken);
    const revoked = nextEvent<{ sessionId: string }>(phoneSocket, 'session.revoked');
    await h.http().delete(`/devices/${phone.deviceId}`).set(auth(laptop.accessToken)).expect(200);
    expect((await revoked).sessionId).toBe(phone.sessionId);

    // The phone's still-unexpired access token no longer works, and neither does its refresh token.
    await h.http().get('/tasks?view=today').set(auth(phone.accessToken)).expect(401);
    await h.http().post('/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(401);
    const after = await h.http().get('/devices').set(auth(laptop.accessToken)).expect(200);
    expect(after.body).toHaveLength(1);
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'device.revoked', targetId: phone.deviceId } });
    expect(audit).toBeTruthy();
  });
});

describe('QR device linking', () => {
  async function reauth(token: string, email: string) {
    const start = await h.http().post('/auth/reauth/start').set(auth(token)).expect(200);
    await h.http().post('/auth/reauth/verify').set(auth(token)).send({ challengeId: start.body.challengeId, code: lastCode(h, email) }).expect(200);
  }

  it('requires recent re-authentication to create a pairing', async () => {
    const email = uniqueEmail('qr-reauth');
    const desktop = await signIn(h, email, DESKTOP);
    // Fresh sign-in counts as re-auth; age it out.
    await h.prisma.session.update({ where: { id: desktop.sessionId }, data: { reauthAt: new Date(Date.now() - 10 * 60_000) } });
    const res = await h.http().post('/pairing').set(auth(desktop.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('reauth_required');
    await reauth(desktop.accessToken, email);
    await h.http().post('/pairing').set(auth(desktop.accessToken)).expect(201);
  });

  it('links a phone: scan → confirm on both devices → own session; token is single-use and never stored', async () => {
    const email = uniqueEmail('qr');
    const desktop = await signIn(h, email, DESKTOP);
    const socket = await connectSocket(h, desktop.accessToken);

    const created = await h.http().post('/pairing').set(auth(desktop.accessToken)).expect(201);
    expect(created.body.deepLink).toMatch(/^remindora:\/\/link\?t=rmd1\./);
    const ttl = new Date(created.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    // Neither the token nor its secret is persisted.
    const row = await h.prisma.devicePairingToken.findUniqueOrThrow({ where: { id: created.body.pairingId } });
    expect(JSON.stringify(row)).not.toContain(created.body.qrToken.slice(5, 30));

    const claimedEvent = nextEvent<{ verificationCode: string; deviceName: string }>(socket, 'pairing.claimed');
    const claim = await h.http().post('/pairing/claim').send({ token: created.body.qrToken, device: PHONE }).expect(200);
    const event = await claimedEvent;
    expect(event.deviceName).toBe(PHONE.name);
    expect(event.verificationCode).toBe(claim.body.verificationCode); // same code shown on both screens

    // Second scan of the same QR fails.
    const reuse = await h.http().post('/pairing/claim').send({ token: created.body.qrToken, device: PHONE });
    expect(reuse.status).toBe(410);
    expect(reuse.body.error.code).toBe('pairing_used');

    // Phone can't complete before the desktop approves.
    const early = await h.http().post(`/pairing/claim/${claim.body.claimId}/complete`).send({ claimSecret: claim.body.claimSecret });
    expect(early.status).toBe(409);

    const completedEvent = nextEvent<{ deviceId: string }>(socket, 'pairing.completed');
    await h.http().post(`/pairing/${created.body.pairingId}/decision`).set(auth(desktop.accessToken)).send({ approve: true }).expect(200);
    const status = await h.http().get(`/pairing/claim/${claim.body.claimId}/status`).set('x-claim-secret', claim.body.claimSecret).expect(200);
    expect(status.body.status).toBe('APPROVED');

    const tokens = await h.http().post(`/pairing/claim/${claim.body.claimId}/complete`).send({ claimSecret: claim.body.claimSecret }).expect(200);
    expect(tokens.body.user.email).toBe(email);
    expect(tokens.body.sessionId).not.toBe(desktop.sessionId);
    expect((await completedEvent).deviceId).toBe(tokens.body.deviceId);
    await h.http().get('/tasks?view=inbox').set(auth(tokens.body.accessToken)).expect(200);

    const again = await h.http().post(`/pairing/claim/${claim.body.claimId}/complete`).send({ claimSecret: claim.body.claimSecret });
    expect(again.status).toBe(410);

    const devices = await h.http().get('/devices').set(auth(desktop.accessToken)).expect(200);
    expect(devices.body.some((d: { id: string }) => d.id === tokens.body.deviceId)).toBe(true);
    socket.disconnect();
  });

  it('expired QR tokens are rejected', async () => {
    const desktop = await signIn(h, uniqueEmail('qr-exp'), DESKTOP);
    const created = await h.http().post('/pairing').set(auth(desktop.accessToken)).expect(201);
    await h.prisma.devicePairingToken.update({ where: { id: created.body.pairingId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await h.http().post('/pairing/claim').send({ token: created.body.qrToken, device: PHONE });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('pairing_expired');
  });

  it('rejects a forged token and lets the initiator reject a claim', async () => {
    const desktop = await signIn(h, uniqueEmail('qr-reject'), DESKTOP);
    const forged = await h.http().post('/pairing/claim').send({ token: 'rmd1.' + 'A'.repeat(80), device: PHONE });
    expect(forged.status).toBe(400);
    const created = await h.http().post('/pairing').set(auth(desktop.accessToken)).expect(201);
    const claim = await h.http().post('/pairing/claim').send({ token: created.body.qrToken, device: PHONE }).expect(200);
    await h.http().post(`/pairing/${created.body.pairingId}/decision`).set(auth(desktop.accessToken)).send({ approve: false }).expect(200);
    const res = await h.http().post(`/pairing/claim/${claim.body.claimId}/complete`).send({ claimSecret: claim.body.claimSecret });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('pairing_cancelled');
  });
});
