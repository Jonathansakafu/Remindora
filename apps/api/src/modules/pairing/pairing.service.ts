import { Inject, Injectable } from '@nestjs/common';
import { claimPairing, createPairingToken, verifyClaimSecret, type PairingRecord, type PairingStore } from '@remindora/auth';
import type { Prisma } from '@remindora/database';
import type { DeviceInfoInput, PairingClaimDTO, PairingCreatedDTO } from '@remindora/types';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RateLimiter } from '../../common/rate-limit';
import type { AuthContext } from '../../common/request';
import { ENV, KEYS, type Keys, type ServerEnv } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';
import { AuthService, type RequestMeta } from '../auth/auth.service';

/**
 * QR device linking.
 *
 *   1. Authenticated device (recently re-authenticated) creates a pairing → encrypted 60 s QR token.
 *   2. New device scans, confirms locally (biometric on Android), claims → both show a 4-digit code.
 *   3. Initiating device explicitly approves.
 *   4. New device completes → receives its own session. The token is single-use throughout.
 *
 * Tokens are never logged or persisted; only sha256(secret) is stored.
 */
@Injectable()
export class PairingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
    @Inject(KEYS) private readonly keys: Keys,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private store(): PairingStore {
    return {
      find: async (id) => (await this.prisma.devicePairingToken.findUnique({ where: { id } })) as PairingRecord | null,
      transition: async (id, from, patch) => {
        const res = await this.prisma.devicePairingToken.updateMany({ where: { id, status: from }, data: patch });
        return res.count === 1;
      },
    };
  }

  async create(a: AuthContext, meta: RequestMeta): Promise<PairingCreatedDTO> {
    await this.limiter.hit(`pairing-create:u:${a.userId}`, 10, 3600);
    // Only one live QR per session.
    await this.prisma.devicePairingToken.updateMany({ where: { initiatorSessionId: a.sessionId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    const id = randomUUID();
    const { token, secretHash, expiresAt } = createPairingToken(this.keys.pairing, id);
    await this.prisma.devicePairingToken.create({ data: { id, userId: a.userId, initiatorSessionId: a.sessionId, secretHash, expiresAt } });
    await this.audit.log({ action: 'pairing.created', actorId: a.userId, sessionId: a.sessionId, targetType: 'pairing', targetId: id, ip: meta.ip });
    return { pairingId: id, qrToken: token, deepLink: `${this.env.APP_DEEP_LINK_SCHEME}://link?t=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() };
  }

  async claim(token: string, device: DeviceInfoInput, meta: RequestMeta): Promise<PairingClaimDTO> {
    await this.limiter.hit(`pairing-claim:ip:${meta.ip}`, 20, 600);
    const result = await claimPairing(this.store(), this.keys.pairing, token);
    if (!result.ok) {
      await this.audit.log({ action: 'pairing.claim_failed', outcome: 'failure', ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: result.error } });
      if (result.error === 'expired') throw Errors.gone('This QR code expired. Generate a new one.', 'pairing_expired');
      if (result.error === 'already_used') throw Errors.gone('This QR code was already used.', 'pairing_used');
      throw Errors.badRequest('This QR code is not valid.', 'pairing_invalid');
    }
    const record = await this.prisma.devicePairingToken.update({
      where: { id: result.pairingId },
      data: { claimantDevice: device as unknown as Prisma.InputJsonValue, claimantIp: meta.ip },
    });
    const initiator = await this.prisma.session.findUnique({ where: { id: record.initiatorSessionId }, include: { device: true } });
    this.realtime.toSession(record.initiatorSessionId, 'pairing.claimed', { pairingId: record.id, deviceName: device.name, platform: device.platform, verificationCode: result.verificationCode });
    await this.audit.log({ action: 'pairing.claimed', actorId: record.userId, targetType: 'pairing', targetId: record.id, ip: meta.ip, metadata: { deviceName: device.name, platform: device.platform } });
    return {
      claimId: record.id,
      claimSecret: result.claimSecret,
      verificationCode: result.verificationCode,
      initiatorDeviceName: initiator?.device.name ?? 'your other device',
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /** The initiating device sees the claim (name + code) and explicitly approves or rejects. */
  async decide(a: AuthContext, pairingId: string, approve: boolean, meta: RequestMeta) {
    const rec = await this.prisma.devicePairingToken.findUnique({ where: { id: pairingId } });
    if (!rec || rec.userId !== a.userId) throw Errors.notFound('Pairing');
    if (rec.initiatorSessionId !== a.sessionId) throw Errors.forbidden('Approve from the device that shows the QR code');
    if (!rec.claimExpiresAt || rec.claimExpiresAt.getTime() <= Date.now()) {
      await this.prisma.devicePairingToken.updateMany({ where: { id: rec.id, status: { in: ['PENDING', 'CLAIMED'] } }, data: { status: 'EXPIRED' } });
      throw Errors.gone('This pairing expired', 'pairing_expired');
    }
    const ok = await this.store().transition(rec.id, 'CLAIMED', approve ? { status: 'APPROVED' } : { status: 'REJECTED' });
    if (!ok) throw Errors.conflict('This pairing is no longer awaiting approval', undefined, 'pairing_state');
    if (approve) await this.prisma.devicePairingToken.update({ where: { id: rec.id }, data: { approvedAt: new Date() } });
    await this.audit.log({ action: approve ? 'pairing.approved' : 'pairing.rejected', actorId: a.userId, sessionId: a.sessionId, targetType: 'pairing', targetId: rec.id, ip: meta.ip });
    return { status: approve ? 'APPROVED' : 'REJECTED' };
  }

  async statusForInitiator(a: AuthContext, pairingId: string) {
    const rec = await this.prisma.devicePairingToken.findUnique({ where: { id: pairingId } });
    if (!rec || rec.userId !== a.userId) throw Errors.notFound('Pairing');
    const expired = rec.status === 'PENDING' && rec.expiresAt.getTime() <= Date.now();
    const claimant = rec.claimantDevice as { name?: string; platform?: string } | null;
    return {
      status: expired ? 'EXPIRED' : rec.status,
      expiresAt: rec.expiresAt.toISOString(),
      claimant: claimant ? { name: claimant.name, platform: claimant.platform, verificationCode: rec.verificationCode } : null,
      createdDeviceId: rec.createdDeviceId,
    };
  }

  async statusForClaimant(pairingId: string, claimSecret: string) {
    const rec = await this.prisma.devicePairingToken.findUnique({ where: { id: pairingId } });
    if (!rec) throw Errors.notFound('Pairing');
    const check = verifyClaimSecret(rec as PairingRecord, claimSecret);
    if (check === 'invalid') throw Errors.notFound('Pairing');
    if (check === 'expired' && rec.status !== 'CONSUMED') return { status: 'EXPIRED' };
    return { status: rec.status };
  }

  async complete(pairingId: string, claimSecret: string, meta: RequestMeta) {
    await this.limiter.hit(`pairing-complete:ip:${meta.ip}`, 30, 600);
    const rec = await this.prisma.devicePairingToken.findUnique({ where: { id: pairingId } });
    if (!rec) throw Errors.notFound('Pairing');
    const check = verifyClaimSecret(rec as PairingRecord, claimSecret);
    if (check === 'invalid') throw Errors.notFound('Pairing');
    if (check === 'expired') throw Errors.gone('This pairing expired', 'pairing_expired');
    if (rec.status !== 'APPROVED') throw Errors.conflict('Waiting for approval on your other device', { status: rec.status }, 'pairing_not_approved');
    const won = await this.store().transition(rec.id, 'APPROVED', { status: 'CONSUMED' });
    if (!won) throw Errors.gone('This pairing was already used', 'pairing_used');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rec.userId } });
    const tokens = await this.auth.issueSession(user, rec.claimantDevice as unknown as DeviceInfoInput, 'QR', meta);
    await this.prisma.devicePairingToken.update({ where: { id: rec.id }, data: { consumedAt: new Date(), createdDeviceId: tokens.deviceId } });
    this.realtime.toSession(rec.initiatorSessionId, 'pairing.completed', { pairingId: rec.id, deviceId: tokens.deviceId });
    await this.audit.log({ action: 'pairing.completed', actorId: user.id, sessionId: tokens.sessionId, targetType: 'device', targetId: tokens.deviceId, ip: meta.ip });
    return tokens;
  }
}
