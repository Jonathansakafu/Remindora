import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  EMAIL_CHALLENGE_MAX_ATTEMPTS,
  EMAIL_CHALLENGE_TTL_MS,
  REFRESH_TOKEN_TTL_DAYS,
  decryptSecret,
  encryptSecret,
  hmacSha256,
  randomToken,
  requiresDeviceApproval,
  safeEqual,
  sessionState,
  sha256,
  signAccessToken,
  sixDigitCode,
} from '@remindora/auth';
import type { DevicePlatform, Prisma, User } from '@remindora/database';
import { createEmailSender, templates, type EmailSender } from '@remindora/notifications';
import type { AuthTokensDTO, DeviceInfoInput, UserDTO } from '@remindora/types';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RateLimiter } from '../../common/rate-limit';
import { RedisService } from '../../common/redis.service';
import { ENV, KEYS, type Keys, type ServerEnv } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type LinkMethod = 'EMAIL_CODE' | 'MAGIC_LINK' | 'OAUTH' | 'QR';

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    locale: u.locale,
    weekStartsOn: u.weekStartsOn as 0 | 1 | 6,
    theme: u.theme,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  readonly email: EmailSender;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(KEYS) private readonly keys: Keys,
  ) {
    this.email = createEmailSender({
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      smtpUrl: env.SMTP_URL,
      resendApiKey: env.RESEND_API_KEY,
      log: (line) => this.logger.log(line),
    });
  }

  private codeHash(challengeId: string, code: string) {
    return hmacSha256(this.keys.otpPepper, `${challengeId}:${code}`);
  }

  // ───────────── Email sign-in (code or magic link) ─────────────

  /**
   * Starts an email sign-in. The response never reveals whether the account exists.
   * The requesting device keeps `pollSecret`; only it can redeem the challenge.
   */
  async startEmail(email: string, device: DeviceInfoInput, meta: RequestMeta, redirectTo?: string) {
    await this.limiter.hit(`email-start:e:${sha256(email)}`, 5, 600);
    await this.limiter.hit(`email-start:ip:${meta.ip}`, 20, 600);

    const user = await this.prisma.user.findUnique({ where: { email } });
    const id = randomUUID();
    const code = sixDigitCode();
    const token = randomToken(32);
    const pollSecret = randomToken(24);
    const expiresAt = new Date(Date.now() + EMAIL_CHALLENGE_TTL_MS);

    await this.prisma.emailChallenge.create({
      data: {
        id,
        email,
        userId: user?.id ?? null,
        purpose: 'SIGN_IN',
        codeHash: this.codeHash(id, code),
        tokenHash: sha256(token),
        pollSecretHash: sha256(pollSecret),
        deviceInfo: device as unknown as Prisma.InputJsonValue,
        redirectTo: redirectTo ?? null,
        ip: meta.ip,
        expiresAt,
      },
    });

    const link = `${this.env.WEB_URL}/auth/magic?c=${id}&t=${token}`;
    const msg = templates.signInCode(code, link, device.name);
    await this.email.send({ ...msg, to: email });
    await this.audit.log({ action: 'auth.email.start', actorId: user?.id, ip: meta.ip, userAgent: meta.userAgent, targetType: 'email_challenge', targetId: id });
    return { challengeId: id, pollSecret, expiresAt: expiresAt.toISOString() };
  }

  /** Verifies a six-digit code typed on the requesting device. Returns tokens or an approval wait. */
  async verifyCode(challengeId: string, code: string, pollSecret: string, meta: RequestMeta) {
    await this.limiter.hit(`email-verify:ip:${meta.ip}`, 30, 600);
    const ch = await this.loadOpenChallenge(challengeId);
    if (!safeEqual(ch.pollSecretHash, sha256(pollSecret))) throw Errors.badRequest('This code belongs to a different sign-in attempt', 'challenge_mismatch');

    const attempts = await this.prisma.emailChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    if (attempts.attempts > EMAIL_CHALLENGE_MAX_ATTEMPTS) {
      await this.prisma.emailChallenge.update({ where: { id: ch.id }, data: { status: 'EXPIRED' } });
      throw Errors.gone('Too many attempts. Request a new code.', 'challenge_locked');
    }
    if (!safeEqual(ch.codeHash, this.codeHash(ch.id, code))) {
      await this.audit.log({ action: 'auth.email.code_invalid', actorId: ch.userId, outcome: 'failure', ip: meta.ip, targetId: ch.id });
      throw Errors.badRequest('That code isn’t right', 'invalid_code', { remaining: EMAIL_CHALLENGE_MAX_ATTEMPTS - attempts.attempts });
    }
    return this.completeVerification(ch.id, 'EMAIL_CODE', meta, { redeemNow: true });
  }

  /**
   * Verifies a magic link (possibly opened on another device). Marks the challenge
   * verified; the requesting device picks the session up by polling with its secret.
   */
  async verifyMagicLink(challengeId: string, token: string, meta: RequestMeta) {
    await this.limiter.hit(`email-verify:ip:${meta.ip}`, 30, 600);
    const ch = await this.loadOpenChallenge(challengeId);
    if (!safeEqual(ch.tokenHash, sha256(token))) throw Errors.badRequest('This link is invalid', 'invalid_link');
    const result = await this.completeVerification(ch.id, 'MAGIC_LINK', meta, { redeemNow: false });
    const device = ch.deviceInfo as unknown as DeviceInfoInput;
    return { status: result.status, deviceName: device.name };
  }

  private async loadOpenChallenge(id: string) {
    const ch = await this.prisma.emailChallenge.findUnique({ where: { id } });
    if (!ch || ch.purpose !== 'SIGN_IN') throw Errors.notFound('Sign-in request');
    if (ch.status !== 'PENDING') throw Errors.gone('This sign-in request was already used', 'challenge_used');
    if (ch.expiresAt.getTime() <= Date.now()) {
      await this.prisma.emailChallenge.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw Errors.gone('This code has expired. Request a new one.', 'challenge_expired');
    }
    return ch;
  }

  private async completeVerification(challengeId: string, method: 'EMAIL_CODE' | 'MAGIC_LINK', meta: RequestMeta, opts: { redeemNow: boolean }) {
    const ch = await this.prisma.emailChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    const user = ch.userId ? await this.prisma.user.findUniqueOrThrow({ where: { id: ch.userId } }) : await this.createUser(ch.email);
    const device = ch.deviceInfo as unknown as DeviceInfoInput;

    const active = await this.prisma.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { lastActiveAt: true } });
    const needsApproval = Boolean(ch.userId) && requiresDeviceApproval({ requireApproval: user.requireDeviceApproval, activeDeviceLastSeen: active.map((s) => s.lastActiveAt) });

    if (needsApproval) {
      const won = await this.prisma.emailChallenge.updateMany({
        where: { id: ch.id, status: 'PENDING' },
        data: { status: 'AWAITING_APPROVAL', approvalRequired: true, verifiedAt: new Date(), userId: user.id },
      });
      if (!won.count) throw Errors.gone('This sign-in request was already used', 'challenge_used');
      this.realtime.toUser(user.id, 'device.approval_requested', { challengeId: ch.id, deviceName: device.name, platform: device.platform, ipCountry: null });
      await this.prisma.notification.create({
        data: {
          userId: user.id,
          kind: 'DEVICE_APPROVAL',
          priority: 'HIGH',
          title: 'Approve new sign-in?',
          body: `${device.name} (${device.platform.toLowerCase()}) is trying to sign in.`,
          data: { challengeId: ch.id },
          dedupeKey: `approval:${ch.id}`,
        },
      });
      await this.audit.log({ action: 'auth.email.awaiting_approval', actorId: user.id, ip: meta.ip, targetId: ch.id });
      return { status: 'awaiting_approval' as const, challengeId: ch.id };
    }

    if (!opts.redeemNow) {
      const won = await this.prisma.emailChallenge.updateMany({ where: { id: ch.id, status: 'PENDING' }, data: { status: 'APPROVED', verifiedAt: new Date(), userId: user.id } });
      if (!won.count) throw Errors.gone('This sign-in request was already used', 'challenge_used');
      return { status: 'verified' as const, challengeId: ch.id };
    }

    const won = await this.prisma.emailChallenge.updateMany({ where: { id: ch.id, status: 'PENDING' }, data: { status: 'CONSUMED', verifiedAt: new Date(), userId: user.id } });
    if (!won.count) throw Errors.gone('This sign-in request was already used', 'challenge_used');
    const tokens = await this.issueSession(user, device, method, meta);
    return { status: 'signed_in' as const, tokens };
  }

  /** Requesting device polls; redeems once approved/verified. */
  async pollChallenge(challengeId: string, pollSecret: string, meta: RequestMeta) {
    await this.limiter.hit(`email-poll:ip:${meta.ip}`, 120, 60);
    const ch = await this.prisma.emailChallenge.findUnique({ where: { id: challengeId } });
    if (!ch || !safeEqual(ch.pollSecretHash, sha256(pollSecret))) throw Errors.notFound('Sign-in request');
    if (ch.status === 'PENDING' && ch.expiresAt.getTime() <= Date.now()) return { status: 'expired' as const };
    if (ch.status !== 'APPROVED') return { status: ch.status.toLowerCase() as 'pending' | 'awaiting_approval' | 'rejected' | 'consumed' | 'expired' };

    const won = await this.prisma.emailChallenge.updateMany({ where: { id: ch.id, status: 'APPROVED' }, data: { status: 'CONSUMED' } });
    if (!won.count) return { status: 'consumed' as const };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ch.userId! } });
    const tokens = await this.issueSession(user, ch.deviceInfo as unknown as DeviceInfoInput, ch.approvalRequired ? 'EMAIL_CODE' : 'MAGIC_LINK', meta);
    return { status: 'signed_in' as const, tokens };
  }

  /** An existing signed-in device approves or rejects a pending sign-in. */
  async decideChallenge(userId: string, sessionId: string, challengeId: string, approve: boolean, meta: RequestMeta) {
    const ch = await this.prisma.emailChallenge.findUnique({ where: { id: challengeId } });
    if (!ch || ch.userId !== userId) throw Errors.notFound('Sign-in request');
    if (ch.status !== 'AWAITING_APPROVAL') throw Errors.gone('This request was already handled', 'challenge_used');
    if (Date.now() - (ch.verifiedAt?.getTime() ?? 0) > EMAIL_CHALLENGE_TTL_MS) {
      await this.prisma.emailChallenge.update({ where: { id: ch.id }, data: { status: 'EXPIRED' } });
      throw Errors.gone('This request expired', 'challenge_expired');
    }
    await this.prisma.emailChallenge.update({
      where: { id: ch.id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedBySession: sessionId },
    });
    await this.audit.log({ action: approve ? 'device.approval.approved' : 'device.approval.rejected', actorId: userId, sessionId, ip: meta.ip, targetId: ch.id });
    return { status: approve ? 'approved' : 'rejected' };
  }

  async createUser(email: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, emailVerifiedAt: new Date(), name: null, notificationPref: { create: {} } } });
      const slugBase = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'space';
      const ws = await tx.workspace.create({
        data: { name: 'Personal', slug: `${slugBase}-${user.id.slice(0, 8)}`, isPersonal: true, ownerId: user.id, memberships: { create: { userId: user.id, role: 'OWNER' } } },
      });
      await tx.project.create({ data: { workspaceId: ws.id, createdById: user.id, name: 'Inbox', isInbox: true, color: '#9DEFFF', icon: 'inbox' } });
      await this.audit.log({ action: 'user.created', actorId: user.id, targetType: 'user', targetId: user.id }, tx);
      return user;
    });
  }

  // ───────────── Sessions ─────────────

  async issueSession(user: User, device: DeviceInfoInput, method: LinkMethod, meta: RequestMeta): Promise<AuthTokensDTO> {
    const refreshToken = randomToken(32);
    const { session, dev } = await this.prisma.$transaction(async (tx) => {
      const dev = await tx.device.create({
        data: {
          userId: user.id,
          name: device.name,
          platform: device.platform as DevicePlatform,
          osVersion: device.osVersion ?? null,
          appVersion: device.appVersion ?? null,
          linkedVia: method,
        },
      });
      const session = await tx.session.create({
        data: {
          userId: user.id,
          deviceId: dev.id,
          refreshTokenHash: sha256(refreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
          ip: meta.ip,
          userAgent: meta.userAgent,
          // A brand-new sign-in counts as a fresh authentication.
          reauthAt: new Date(),
        },
      });
      await this.audit.log({ action: 'session.created', actorId: user.id, sessionId: session.id, ip: meta.ip, userAgent: meta.userAgent, targetType: 'device', targetId: dev.id, metadata: { method, platform: device.platform } }, tx);
      return { session, dev };
    });

    const otherDevices = await this.prisma.device.count({ where: { userId: user.id, revokedAt: null, id: { not: dev.id } } });
    if (otherDevices > 0) {
      const msg = templates.newDevice(device.name, method.replace('_', ' ').toLowerCase(), new Date().toUTCString());
      this.email.send({ ...msg, to: user.email }).catch((e) => this.logger.warn(`new-device email failed: ${(e as Error).message}`));
    }
    return this.tokensFor(user, session.id, dev.id, refreshToken);
  }

  private tokensFor(user: User, sessionId: string, deviceId: string, refreshToken: string): AuthTokensDTO {
    const { token, expiresAt } = signAccessToken(this.keys.jwt, { sub: user.id, sid: sessionId, did: deviceId }, ACCESS_TOKEN_TTL_SECONDS);
    return { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), refreshToken, sessionId, deviceId, user: toUserDTO(user) };
  }

  /**
   * Rotates the refresh token. Presenting an already-rotated token means it was
   * copied — the whole session is revoked (refresh-token reuse detection).
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokensDTO> {
    const hash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { device: true, user: true } });
    if (!session) {
      const reused = await this.prisma.session.findUnique({ where: { prevRefreshTokenHash: hash } });
      if (reused && !reused.revokedAt) {
        await this.revokeSession(reused.id, 'refresh_token_reuse');
        await this.audit.log({ action: 'session.reuse_detected', actorId: reused.userId, sessionId: reused.id, outcome: 'denied', ip: meta.ip });
      }
      throw Errors.unauthorized('Session expired', 'session_revoked');
    }
    if (sessionState(session, session.device) !== 'active' || session.user.deletedAt) throw Errors.unauthorized('Session expired', 'session_revoked');

    const next = randomToken(32);
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: hash },
      data: { refreshTokenHash: sha256(next), prevRefreshTokenHash: hash, lastActiveAt: new Date(), ip: meta.ip ?? session.ip },
    });
    if (!rotated.count) throw Errors.unauthorized('Session expired', 'session_revoked');
    await this.prisma.device.update({ where: { id: session.deviceId }, data: { lastActiveAt: new Date() } });
    return this.tokensFor(session.user, session.id, session.deviceId, next);
  }

  async revokeSession(sessionId: string, reason: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    this.realtime.revokeSession(sessionId);
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    await this.revokeSession(sessionId, 'logout');
    // A logged-out device is unlinked; it must sign in again to reappear.
    if (session) await this.prisma.device.update({ where: { id: session.deviceId }, data: { revokedAt: new Date(), pushTokenEnc: null, pushEnabled: false } });
    await this.audit.log({ action: 'session.logout', actorId: userId, sessionId, ip: meta.ip });
  }

  // ───────────── Re-authentication ─────────────

  async startReauth(userId: string, sessionId: string, meta: RequestMeta) {
    await this.limiter.hit(`reauth:u:${userId}`, 5, 600);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const id = randomUUID();
    const code = sixDigitCode();
    await this.prisma.emailChallenge.create({
      data: {
        id,
        email: user.email,
        userId,
        purpose: 'REAUTH',
        sessionId,
        codeHash: this.codeHash(id, code),
        tokenHash: sha256(randomToken(32)),
        pollSecretHash: sha256(randomToken(24)),
        deviceInfo: {},
        ip: meta.ip,
        expiresAt: new Date(Date.now() + EMAIL_CHALLENGE_TTL_MS),
      },
    });
    await this.email.send({ ...templates.reauthCode(code), to: user.email });
    return { challengeId: id };
  }

  async verifyReauth(userId: string, sessionId: string, challengeId: string, code: string, meta: RequestMeta) {
    const ch = await this.prisma.emailChallenge.findUnique({ where: { id: challengeId } });
    if (!ch || ch.purpose !== 'REAUTH' || ch.userId !== userId || ch.sessionId !== sessionId) throw Errors.notFound('Confirmation request');
    if (ch.status !== 'PENDING' || ch.expiresAt.getTime() <= Date.now()) throw Errors.gone('This code has expired', 'challenge_expired');
    const updated = await this.prisma.emailChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    if (updated.attempts > EMAIL_CHALLENGE_MAX_ATTEMPTS) throw Errors.gone('Too many attempts', 'challenge_locked');
    if (!safeEqual(ch.codeHash, this.codeHash(ch.id, code))) throw Errors.badRequest('That code isn’t right', 'invalid_code');
    await this.prisma.$transaction([
      this.prisma.emailChallenge.update({ where: { id: ch.id }, data: { status: 'CONSUMED' } }),
      this.prisma.session.update({ where: { id: sessionId }, data: { reauthAt: new Date() } }),
    ]);
    await this.audit.log({ action: 'session.reauth', actorId: userId, sessionId, ip: meta.ip, metadata: { method: 'email_code' } });
    return { ok: true, reauthUntil: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  /**
   * Native biometric re-auth enrolment. The secret goes into secure storage that
   * requires a biometric unlock to read; the server keeps it encrypted.
   * Enrolment itself needs a fresh authentication.
   */
  async enrollBiometric(userId: string, sessionId: string, deviceId: string) {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    if (!session.reauthAt || Date.now() - session.reauthAt.getTime() > 5 * 60_000) throw Errors.reauthRequired();
    const secret = randomToken(32);
    await this.prisma.device.update({ where: { id: deviceId }, data: { reauthSecretEnc: encryptSecret(this.keys.encryption, secret, `device:${deviceId}`) } });
    await this.audit.log({ action: 'device.biometric_enrolled', actorId: userId, sessionId, targetType: 'device', targetId: deviceId });
    return { secret };
  }

  async biometricChallenge(deviceId: string) {
    const nonce = randomToken(24);
    await this.redis.client.set(`bio:${deviceId}:${nonce}`, '1', 'EX', 120);
    return { nonce };
  }

  async verifyBiometric(userId: string, sessionId: string, deviceId: string, nonce: string, signature: string, meta: RequestMeta) {
    const used = await this.redis.client.del(`bio:${deviceId}:${nonce}`);
    if (!used) throw Errors.gone('Challenge expired', 'challenge_expired');
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    if (!device.reauthSecretEnc) throw Errors.badRequest('Biometric unlock is not set up on this device', 'biometric_not_enrolled');
    const secret = decryptSecret(this.keys.encryption, device.reauthSecretEnc, `device:${deviceId}`);
    const expected = hmacSha256(Buffer.from(secret), nonce);
    if (!safeEqual(expected, signature)) {
      await this.audit.log({ action: 'session.reauth', actorId: userId, sessionId, outcome: 'failure', ip: meta.ip, metadata: { method: 'biometric' } });
      throw Errors.unauthorized('Biometric confirmation failed', 'reauth_failed');
    }
    await this.prisma.session.update({ where: { id: sessionId }, data: { reauthAt: new Date() } });
    await this.audit.log({ action: 'session.reauth', actorId: userId, sessionId, ip: meta.ip, metadata: { method: 'biometric' } });
    return { ok: true, reauthUntil: new Date(Date.now() + 5 * 60_000).toISOString() };
  }
}
