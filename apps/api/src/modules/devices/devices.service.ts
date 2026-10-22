import { Inject, Injectable } from '@nestjs/common';
import { encryptSecret } from '@remindora/auth';
import type { DeviceDTO } from '@remindora/types';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { KEYS, type Keys } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';
import type { RequestMeta } from '../auth/auth.service';

export type PushProvider = 'fcm' | 'expo' | 'webpush';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(KEYS) private readonly keys: Keys,
  ) {}

  async list(userId: string, currentDeviceId: string): Promise<DeviceDTO[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId, revokedAt: null },
      include: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: 'desc' }, take: 1 } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      sessionId: d.sessions[0]?.id ?? null,
      name: d.name,
      platform: d.platform,
      osVersion: d.osVersion,
      appVersion: d.appVersion,
      lastActiveAt: d.lastActiveAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      current: d.id === currentDeviceId,
      pushEnabled: d.pushEnabled,
    }));
  }

  async rename(userId: string, deviceId: string, name: string) {
    const res = await this.prisma.device.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { name } });
    if (!res.count) throw Errors.notFound('Device');
    return { ok: true };
  }

  /** Remote sign-out: revokes the device and every session on it, effective immediately. */
  async revoke(userId: string, deviceId: string, actorSessionId: string, meta: RequestMeta) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId, revokedAt: null }, include: { sessions: { where: { revokedAt: null } } } });
    if (!device) throw Errors.notFound('Device');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now, revokedReason: 'device_revoked' } }),
      this.prisma.device.update({ where: { id: deviceId }, data: { revokedAt: now, pushTokenEnc: null, pushEnabled: false, reauthSecretEnc: null } }),
    ]);
    for (const s of device.sessions) this.realtime.revokeSession(s.id);
    await this.audit.log({ action: 'device.revoked', actorId: userId, sessionId: actorSessionId, targetType: 'device', targetId: deviceId, ip: meta.ip, userAgent: meta.userAgent, metadata: { name: device.name, platform: device.platform } });
    return { ok: true, revokedSessions: device.sessions.length };
  }

  async revokeOthers(userId: string, currentDeviceId: string, actorSessionId: string, meta: RequestMeta) {
    const others = await this.prisma.device.findMany({ where: { userId, revokedAt: null, id: { not: currentDeviceId } }, select: { id: true } });
    for (const d of others) await this.revoke(userId, d.id, actorSessionId, meta);
    return { ok: true, revoked: others.length };
  }

  async registerPush(userId: string, deviceId: string, provider: PushProvider, token: string) {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { pushProvider: provider, pushTokenEnc: encryptSecret(this.keys.encryption, token, `push:${deviceId}`), pushEnabled: true },
    });
    await this.audit.log({ action: 'device.push_registered', actorId: userId, targetType: 'device', targetId: deviceId, metadata: { provider } });
    return { ok: true };
  }

  async unregisterPush(deviceId: string) {
    await this.prisma.device.update({ where: { id: deviceId }, data: { pushTokenEnc: null, pushEnabled: false } });
    return { ok: true };
  }
}
