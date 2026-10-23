import { decryptSecret } from '@remindora/auth';
import type { Device, Notification } from '@remindora/database';
import { androidChannelForNotification, REMINDER_CATEGORY, templates } from '@remindora/notifications';
import { realtimeRooms, type NotificationChannel, type NotificationDTO } from '@remindora/types';
import type { Deps } from '../deps';
import { PushError, type PushMessage } from './push';

/** Strips secret-bearing fields (invite tokens) before sending a notification to clients. */
function publicData(data: unknown): Record<string, unknown> {
  const { token: _token, ...rest } = (data ?? {}) as Record<string, unknown>;
  return rest;
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n.id,
    taskId: n.taskId,
    reminderId: n.reminderId,
    kind: n.kind,
    priority: n.priority,
    title: n.title,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    data: publicData(n.data),
    actions: n.kind === 'REMINDER' && n.reminderId ? ['complete', 'snooze', 'reschedule', 'stop', 'open'] : n.taskId ? ['open'] : [],
  };
}

async function event(d: Deps, n: Notification, type: string, channel: string | null, deviceId: string | null, metadata: Record<string, unknown> = {}) {
  await d.prisma.notificationEvent.create({ data: { userId: n.userId, notificationId: n.id, reminderId: n.reminderId, deviceId, type, channel, metadata: metadata as object } });
}

async function record(d: Deps, n: Notification, channel: string, deviceId: string | null, status: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED', extra: { providerMessageId?: string; error?: string } = {}) {
  const data = { notificationId: n.id, channel, deviceId, status, providerMessageId: extra.providerMessageId, error: extra.error };
  if (deviceId) {
    await d.prisma.notificationDelivery.upsert({
      where: { notificationId_channel_deviceId: { notificationId: n.id, channel, deviceId } },
      create: data,
      update: { status, providerMessageId: extra.providerMessageId, error: extra.error },
    });
  } else {
    // Device-less channels (in-app, email) are recorded once per notification.
    await d.prisma.notificationDelivery.create({ data });
  }
  await event(d, n, status === 'FAILED' ? 'FAILED' : status === 'SUPPRESSED' ? 'SUPPRESSED' : 'DELIVERED', channel, deviceId, extra.error ? { error: extra.error } : {});
}

function pushToken(d: Deps, device: Device): string | null {
  if (!device.pushTokenEnc) return null;
  try {
    return decryptSecret(d.keys.encryption, device.pushTokenEnc, `push:${device.id}`);
  } catch {
    return null;
  }
}

async function disablePush(d: Deps, deviceId: string) {
  await d.prisma.device.update({ where: { id: deviceId }, data: { pushEnabled: false, pushTokenEnc: null } });
}

/**
 * Delivers a notification on the chosen channels. Every attempt is recorded in
 * NotificationDelivery and logged as a NotificationEvent (delivered / failed).
 */
export async function deliver(d: Deps, n: Notification, channels: NotificationChannel[], opts: { silent: boolean; link: string; whenLabel?: string }) {
  const results: Record<string, number> = {};
  const bump = (k: string) => (results[k] = (results[k] ?? 0) + 1);
  const devices = await d.prisma.device.findMany({ where: { userId: n.userId, revokedAt: null } });

  if (channels.includes('IN_APP')) {
    d.emitter.to(realtimeRooms.user(n.userId)).emit('notification.created', {
      notification: toNotificationDTO(n),
      alert: { desktop: !opts.silent && channels.includes('DESKTOP'), webPush: !opts.silent && channels.includes('WEB_PUSH'), sound: !opts.silent },
    });
    await record(d, n, 'IN_APP', null, 'DELIVERED');
    bump('in_app');
  }

  if (channels.includes('DESKTOP')) {
    // Desktop apps raise a native notification from the realtime event above; offline desktops
    // pick unacknowledged items up from the notification center when they reconnect.
    for (const dev of devices.filter((x) => x.platform.startsWith('DESKTOP_'))) {
      await record(d, n, 'DESKTOP', dev.id, 'SENT');
      bump('desktop');
    }
  }

  const msg: PushMessage = {
    title: n.title,
    body: n.body,
    data: { type: n.kind.toLowerCase(), notificationId: n.id, reminderId: n.reminderId ?? '', taskId: n.taskId ?? '', priority: n.priority, url: opts.link },
    channelId: androidChannelForNotification(n.kind, n.priority).id,
    tag: n.reminderId ?? n.id,
    categoryId: n.reminderId ? REMINDER_CATEGORY : undefined,
    sound: !opts.silent,
  };

  if (channels.includes('PUSH')) {
    for (const dev of devices.filter((x) => x.pushEnabled && (x.pushProvider === 'fcm' || x.pushProvider === 'expo'))) {
      const token = pushToken(d, dev);
      if (!token) continue;
      try {
        const send = dev.pushProvider === 'fcm' ? d.push.fcm : d.push.expo;
        if (!send) {
          await record(d, n, 'PUSH', dev.id, 'SUPPRESSED', { error: 'provider_not_configured' });
          continue;
        }
        const id = await send(token, msg);
        await record(d, n, 'PUSH', dev.id, 'SENT', { providerMessageId: id });
        bump('push');
      } catch (e) {
        await record(d, n, 'PUSH', dev.id, 'FAILED', { error: (e as Error).message.slice(0, 200) });
        if (e instanceof PushError && e.gone) await disablePush(d, dev.id);
      }
    }
  }

  if (channels.includes('WEB_PUSH') && d.push.webPush) {
    for (const dev of devices.filter((x) => x.pushEnabled && x.pushProvider === 'webpush')) {
      const sub = pushToken(d, dev);
      if (!sub) continue;
      try {
        const id = await d.push.webPush(sub, { type: 'notification', title: n.title, body: n.body, tag: msg.tag, data: msg.data, requireInteraction: n.priority === 'CRITICAL', silent: opts.silent }, msg.tag);
        await record(d, n, 'WEB_PUSH', dev.id, 'SENT', { providerMessageId: id });
        bump('web_push');
      } catch (e) {
        await record(d, n, 'WEB_PUSH', dev.id, 'FAILED', { error: (e as Error).message.slice(0, 200) });
        if (e instanceof PushError && e.gone) await disablePush(d, dev.id);
      }
    }
  }

  if (channels.includes('EMAIL')) {
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: n.userId } });
    try {
      const m = templates.reminder(n.title, opts.whenLabel ?? 'now', n.priority, opts.link);
      const res = await d.email.send({ ...m, to: user.email });
      await record(d, n, 'EMAIL', null, 'SENT', { providerMessageId: res.id ?? undefined });
      bump('email');
    } catch (e) {
      await record(d, n, 'EMAIL', null, 'FAILED', { error: (e as Error).message.slice(0, 200) });
    }
  }
  return results;
}

/** Clears a resolved notification from the user's other devices (tray dismissal). */
export async function dismissElsewhere(d: Deps, userId: string, notificationId: string, reminderId: string | null, exceptDeviceId: string | null) {
  const devices = await d.prisma.device.findMany({ where: { userId, revokedAt: null, pushEnabled: true, id: exceptDeviceId ? { not: exceptDeviceId } : undefined } });
  const data = { type: 'dismiss', notificationId, reminderId: reminderId ?? '', tag: reminderId ?? notificationId };
  let sent = 0;
  for (const dev of devices) {
    const token = pushToken(d, dev);
    if (!token) continue;
    try {
      if (dev.pushProvider === 'fcm' && d.push.fcm) await d.push.fcm(token, { dataOnly: data });
      else if (dev.pushProvider === 'expo') await d.push.expo(token, { dataOnly: data });
      else if (dev.pushProvider === 'webpush' && d.push.webPush) await d.push.webPush(token, data, data.tag);
      sent++;
    } catch (e) {
      if (e instanceof PushError && e.gone) await disablePush(d, dev.id);
    }
  }
  return sent;
}
