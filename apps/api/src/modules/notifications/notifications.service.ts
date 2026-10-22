import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@remindora/database';
import { applyReminderAction, DEFAULT_PREFS, type ReminderAction } from '@remindora/notifications';
import type { NotificationDTO, NotificationPreferenceDTO, NotificationPreferenceInput, Priority } from '@remindora/types';
import { randomUUID } from 'node:crypto';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../../queues/queue.service';
import { RealtimeService } from '../../realtime/realtime.service';

/** Strips secret-bearing fields (invite tokens) before sending a notification to clients. */
function publicData(data: unknown): Record<string, unknown> {
  const { token: _token, ...rest } = (data ?? {}) as Record<string, unknown>;
  return rest;
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  const isReminder = n.kind === 'REMINDER' && n.reminderId;
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
    actions: isReminder ? ['complete', 'snooze', 'reschedule', 'stop', 'open'] : n.taskId ? ['open'] : [],
  };
}

export interface InAppInput {
  kind: 'ASSIGNMENT' | 'MENTION' | 'COMMENT' | 'INVITE' | 'SYSTEM' | 'DEVICE_APPROVAL' | 'TEST';
  priority?: Priority;
  title: string;
  body: string;
  taskId?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  /** Also deliver to push/desktop/web-push channels. */
  push?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly queues: QueueService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async event(userId: string, type: string, data: { notificationId?: string | null; reminderId?: string | null; deviceId?: string | null; channel?: string | null; metadata?: Record<string, unknown> }) {
    await this.prisma.notificationEvent.create({
      data: {
        userId,
        type,
        notificationId: data.notificationId ?? null,
        reminderId: data.reminderId ?? null,
        deviceId: data.deviceId ?? null,
        channel: data.channel ?? null,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async createInApp(userId: string, input: InAppInput) {
    const n = await this.prisma.notification.upsert({
      where: { dedupeKey: input.dedupeKey ?? `inapp:${randomUUID()}` },
      create: {
        userId,
        kind: input.kind,
        priority: input.priority ?? 'MEDIUM',
        title: input.title,
        body: input.body,
        taskId: input.taskId ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey ?? `inapp:${randomUUID()}`,
      },
      update: {},
    });
    this.realtime.toUser(userId, 'notification.created', { notification: toNotificationDTO(n) });
    if (input.push) await this.queues.push.add('notify', { userId, notificationId: n.id, reminderId: null, exceptDeviceId: null });
    return n;
  }

  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number; before?: string }) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}), ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items: rows.map(toNotificationDTO), unread };
  }

  async markRead(userId: string, id: string, deviceId: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw Errors.notFound('Notification');
    if (!n.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
      await this.event(userId, 'OPENED', { notificationId: id, reminderId: n.reminderId, deviceId });
    }
    return { ok: true };
  }

  async readAll(userId: string) {
    const res = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, count: res.count };
  }

  async delivered(userId: string, id: string, deviceId: string, channel: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw Errors.notFound('Notification');
    await this.prisma.notificationDelivery.updateMany({ where: { notificationId: id, deviceId, channel }, data: { status: 'DELIVERED' } });
    await this.event(userId, 'DELIVERED', { notificationId: id, reminderId: n.reminderId, deviceId, channel, metadata: { confirmedByClient: true } });
    return { ok: true };
  }

  /**
   * Applies a reminder action and resolves the notification everywhere: the
   * realtime event dismisses it on open clients and a data push clears it from
   * other phones' trays, so the same alert is never handled twice.
   */
  async applyAction(userId: string, deviceId: string, notificationId: string, action: ReminderAction, opts: { snoozeMinutes?: number; rescheduleTo?: Date }) {
    const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!n) throw Errors.notFound('Notification');
    if (n.reminderId) {
      const change = applyReminderAction(action, { now: new Date(), snoozeMinutes: opts.snoozeMinutes, rescheduleTo: opts.rescheduleTo });
      if (action !== 'complete' && action !== 'reschedule') {
        const reminder = await this.prisma.reminder.update({ where: { id: n.reminderId }, data: { state: change.state, nextFireAt: change.nextFireAt, lockedUntil: null } });
        if (change.nextFireAt) await this.queues.scheduleReminder(reminder.id, change.nextFireAt, reminder.attempt);
      }
      await this.event(userId, change.event, { notificationId, reminderId: n.reminderId, deviceId, metadata: { action, snoozeMinutes: opts.snoozeMinutes } });
    }
    await this.resolve(userId, n, action, deviceId);
    return { ok: true };
  }

  async resolve(userId: string, n: Notification, resolution: string, originDeviceId: string | null) {
    if (!n.acknowledgedAt) {
      await this.prisma.notification.update({ where: { id: n.id }, data: { acknowledgedAt: new Date(), readAt: n.readAt ?? new Date(), resolution } });
    }
    this.realtime.toUser(userId, 'notification.resolved', { notificationId: n.id, reminderId: n.reminderId, resolution });
    await this.queues.dismissOnOtherDevices({ userId, notificationId: n.id, reminderId: n.reminderId, exceptDeviceId: originDeviceId });
  }

  /** Resolves every open reminder notification for a task (it was completed, deleted…). */
  async resolveForTask(taskId: string, resolution: string, originDeviceId: string | null) {
    const open = await this.prisma.notification.findMany({ where: { taskId, acknowledgedAt: null, kind: 'REMINDER' } });
    for (const n of open) {
      await this.resolve(n.userId, n, resolution, originDeviceId);
      await this.event(n.userId, resolution === 'completed' ? 'COMPLETED' : 'STOPPED', { notificationId: n.id, reminderId: n.reminderId, deviceId: originDeviceId });
    }
  }

  // ── Preferences ──

  async preferences(userId: string): Promise<NotificationPreferenceDTO> {
    const [user, pref, overrides] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.prisma.projectNotificationOverride.findMany({ where: { userId } }),
    ]);
    return {
      timezone: user.timezone,
      channels: { ...DEFAULT_PREFS.channels, ...(pref.channels as object) },
      criticalRepeatMinutes: pref.criticalRepeatMinutes,
      highRepeatMinutes: pref.highRepeatMinutes,
      mediumFollowUpMinutes: pref.mediumFollowUpMinutes,
      maxRealerts: pref.maxRealerts,
      criticalEmail: pref.criticalEmail,
      quietHoursEnabled: pref.quietHoursEnabled,
      quietStart: pref.quietStart,
      quietEnd: pref.quietEnd,
      criticalBypassQuietHours: pref.criticalBypassQuietHours,
      weekendsEnabled: pref.weekendsEnabled,
      lowPriorityMode: pref.lowPriorityMode as 'inbox' | 'digest',
      morningDigestEnabled: pref.morningDigestEnabled,
      morningDigestTime: pref.morningDigestTime,
      eveningPlanningEnabled: pref.eveningPlanningEnabled,
      eveningPlanningTime: pref.eveningPlanningTime,
      projectOverrides: overrides.map((o) => ({
        projectId: o.projectId,
        muted: o.muted,
        channels: (o.channels as NotificationPreferenceDTO['channels'] | null) ?? null,
        criticalRepeatMinutes: o.criticalRepeatMinutes,
        highRepeatMinutes: o.highRepeatMinutes,
      })),
    };
  }

  async updatePreferences(userId: string, input: NotificationPreferenceInput & { lowPriorityMode?: 'inbox' | 'digest' }) {
    const { timezone, channels, ...rest } = input;
    if ((channels?.email || input.criticalEmail) && !(await this.entitlements.has(userId, 'reminders.email'))) {
      throw Errors.planFeature('reminders.email');
    }
    if (timezone) await this.prisma.user.update({ where: { id: userId }, data: { timezone } });
    const current = await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId }, update: {} });
    await this.prisma.notificationPreference.update({
      where: { userId },
      data: { ...rest, ...(channels ? { channels: { ...(current.channels as object), ...channels } } : {}) },
    });
    // Intervals / quiet hours changed: pending re-alerts are recomputed by the worker on next fire.
    return this.preferences(userId);
  }

  async setProjectOverride(userId: string, projectId: string, data: { muted?: boolean; channels?: Record<string, boolean> | null; criticalRepeatMinutes?: number | null; highRepeatMinutes?: number | null }) {
    const membership = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null, workspace: { memberships: { some: { userId } } } } });
    if (!membership) throw Errors.notFound('Project');
    const payload = { ...data, channels: data.channels === null ? undefined : (data.channels ?? undefined) } as Prisma.ProjectNotificationOverrideUncheckedCreateInput;
    await this.prisma.projectNotificationOverride.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { ...payload, userId, projectId },
      update: payload,
    });
    return this.preferences(userId);
  }

  async clearProjectOverride(userId: string, projectId: string) {
    await this.prisma.projectNotificationOverride.deleteMany({ where: { userId, projectId } });
    return this.preferences(userId);
  }

  async events(userId: string, limit = 100) {
    const rows = await this.prisma.notificationEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) });
    return rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
  }
}
