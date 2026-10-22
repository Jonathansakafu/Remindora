import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import type { AttachmentDTO, CommentDTO } from '@remindora/types';
import { AccessService } from '../../common/access.service';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { ENV, type ServerEnv } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReminderScheduler } from './reminder-scheduler.service';
import { TasksService } from './tasks.service';

const BLOCKED_TYPES = /^(application\/(x-msdownload|x-msdos-program|x-sh|x-executable|java-archive)|text\/html)/;

@Injectable()
export class TaskExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly scheduler: ReminderScheduler,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private async refresh(userId: string, taskId: string, originSessionId?: string) {
    await this.prisma.task.update({ where: { id: taskId }, data: { version: { increment: 1 } } });
    const dto = await this.tasks.load(userId, taskId);
    this.realtime.toWorkspace(dto.workspaceId, 'task.upserted', { task: dto, originSessionId });
    return dto;
  }

  // ── Checklist ──
  async addSubtask(userId: string, taskId: string, title: string, sessionId?: string) {
    const { task } = await this.access.task(userId, taskId, 'task.update');
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'checklistItemsPerTask.max', await this.prisma.subtask.count({ where: { taskId } }));
    const max = await this.prisma.subtask.aggregate({ where: { taskId }, _max: { sortOrder: true } });
    await this.prisma.subtask.create({ data: { taskId, title, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'checklist_added', entityType: 'task', entityId: taskId, projectId: task.projectId, data: { title } });
    return this.refresh(userId, taskId, sessionId);
  }

  async updateSubtask(userId: string, subtaskId: string, data: { title?: string; done?: boolean; sortOrder?: number; remindAt?: string | null }, sessionId?: string) {
    const sub = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!sub) throw Errors.notFound('Checklist item');
    const { task } = await this.access.task(userId, sub.taskId, 'task.update');
    if (data.remindAt !== undefined && data.remindAt !== null) await this.entitlements.assertFeature(userId, 'reminders.checklist');
    await this.prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        title: data.title,
        sortOrder: data.sortOrder,
        ...(data.done !== undefined ? { done: data.done, completedAt: data.done ? new Date() : null } : {}),
        ...(data.remindAt !== undefined ? { remindAt: data.remindAt ? new Date(data.remindAt) : null } : {}),
      },
    });
    if (data.remindAt !== undefined) {
      if (data.remindAt) {
        const existing = await this.prisma.reminder.findFirst({ where: { subtaskId } });
        if (!existing) await this.prisma.reminder.create({ data: { taskId: task.id, subtaskId, userId: task.assigneeId ?? task.creatorId, at: new Date(data.remindAt) } });
      } else {
        await this.prisma.reminder.deleteMany({ where: { subtaskId } });
      }
      await this.scheduler.rescheduleTask(task.id);
    }
    if (data.done !== undefined) {
      await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: data.done ? 'checklist_checked' : 'checklist_unchecked', entityType: 'task', entityId: task.id, projectId: task.projectId, data: { title: sub.title } });
    }
    return this.refresh(userId, task.id, sessionId);
  }

  async deleteSubtask(userId: string, subtaskId: string, sessionId?: string) {
    const sub = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!sub) throw Errors.notFound('Checklist item');
    await this.access.task(userId, sub.taskId, 'task.update');
    await this.prisma.subtask.delete({ where: { id: subtaskId } });
    return this.refresh(userId, sub.taskId, sessionId);
  }

  // ── Reminders ──
  async addReminder(userId: string, taskId: string, input: { offsetMinutes?: number; at?: string; constant?: boolean }, sessionId?: string) {
    const { task } = await this.access.task(userId, taskId, 'task.update');
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'remindersPerTask.max', await this.prisma.reminder.count({ where: { taskId, subtaskId: null } }));
    if (input.constant && !ent.features['reminders.constant']) throw Errors.planFeature('reminders.constant');
    if (!input.at && !task.dueAt) throw Errors.badRequest('Set a due date or an exact reminder time', 'reminder_needs_time');
    await this.prisma.reminder.create({
      data: { taskId, userId: task.assigneeId ?? task.creatorId, offsetMinutes: input.at ? null : (input.offsetMinutes ?? 0), at: input.at ? new Date(input.at) : null, constant: input.constant ?? false },
    });
    await this.scheduler.rescheduleTask(taskId);
    return this.refresh(userId, taskId, sessionId);
  }

  async deleteReminder(userId: string, reminderId: string, sessionId?: string) {
    const r = await this.prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!r) throw Errors.notFound('Reminder');
    await this.access.task(userId, r.taskId, 'task.update');
    await this.prisma.reminder.delete({ where: { id: reminderId } });
    return this.refresh(userId, r.taskId, sessionId);
  }

  // ── Comments ──
  async comments(userId: string, taskId: string): Promise<CommentDTO[]> {
    await this.access.task(userId, taskId, 'task.read');
    const rows = await this.prisma.comment.findMany({ where: { taskId, deletedAt: null }, include: { author: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => ({ id: c.id, taskId: c.taskId, authorId: c.authorId, authorName: c.author.name ?? c.author.email, body: c.body, mentions: c.mentions, createdAt: c.createdAt.toISOString(), editedAt: c.editedAt?.toISOString() ?? null }));
  }

  async addComment(userId: string, taskId: string, body: string, mentions: string[], sessionId?: string) {
    const { task } = await this.access.task(userId, taskId, 'comment.create');
    const members = await this.prisma.membership.findMany({ where: { workspaceId: task.workspaceId, userId: { in: mentions } }, select: { userId: true } });
    const valid = members.map((m) => m.userId).filter((id) => id !== userId);
    const comment = await this.prisma.comment.create({ data: { taskId, authorId: userId, body, mentions: valid } });
    const author = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'commented', entityType: 'task', entityId: taskId, projectId: task.projectId, data: { commentId: comment.id } });
    for (const m of valid) {
      await this.notifications.createInApp(m, { kind: 'MENTION', priority: 'MEDIUM', title: `${author.name ?? author.email} mentioned you`, body: `${task.title} — “${body.slice(0, 140)}”`, taskId, push: true, dedupeKey: `mention:${comment.id}:${m}` });
    }
    // Notify the assignee/creator about comments from others (excluding mentioned users already notified).
    const watchers = [...new Set([task.assigneeId, task.creatorId].filter((id): id is string => !!id && id !== userId && !valid.includes(id)))];
    for (const w of watchers) {
      await this.notifications.createInApp(w, { kind: 'COMMENT', priority: 'LOW', title: `${author.name ?? author.email} commented`, body: `${task.title} — “${body.slice(0, 140)}”`, taskId, dedupeKey: `comment:${comment.id}:${w}` });
    }
    this.realtime.toWorkspace(task.workspaceId, 'comment.created', { taskId, commentId: comment.id });
    await this.refresh(userId, taskId, sessionId);
    return (await this.comments(userId, taskId)).find((c) => c.id === comment.id)!;
  }

  async editComment(userId: string, commentId: string, body: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c || c.deletedAt) throw Errors.notFound('Comment');
    await this.access.task(userId, c.taskId, 'task.read');
    if (c.authorId !== userId) throw Errors.forbidden('You can only edit your own comments');
    await this.prisma.comment.update({ where: { id: commentId }, data: { body, editedAt: new Date() } });
    return { ok: true };
  }

  async deleteComment(userId: string, commentId: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c || c.deletedAt) throw Errors.notFound('Comment');
    const { task } = await this.access.task(userId, c.taskId, c.authorId === userId ? 'task.read' : 'comment.moderate');
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    await this.audit.log({ action: 'comment.deleted', actorId: userId, workspaceId: task.workspaceId, targetType: 'comment', targetId: commentId });
    await this.refresh(userId, c.taskId);
    return { ok: true };
  }

  // ── Attachments ──
  private toAttachmentDTO(a: { id: string; taskId: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date }): AttachmentDTO {
    return { id: a.id, taskId: a.taskId, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, url: null, createdAt: a.createdAt.toISOString() };
  }

  async attachments(userId: string, taskId: string) {
    await this.access.task(userId, taskId, 'task.read');
    const rows = await this.prisma.attachment.findMany({ where: { taskId, deletedAt: null, status: 'READY' }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => this.toAttachmentDTO(a));
  }

  /** Daily limit is per local calendar day in the uploader's timezone. */
  async createAttachment(userId: string, taskId: string, input: { fileName: string; contentType: string; sizeBytes: number }) {
    const { task } = await this.access.task(userId, taskId, 'attachment.create');
    if (input.sizeBytes > this.env.MAX_ATTACHMENT_BYTES) throw Errors.badRequest(`Files can be up to ${Math.round(this.env.MAX_ATTACHMENT_BYTES / 1048576)} MB`, 'file_too_large');
    if (BLOCKED_TYPES.test(input.contentType)) throw Errors.badRequest('This file type is not allowed', 'file_type');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const dayStart = DateTime.now().setZone(user.timezone).startOf('day').toJSDate();
    const today = await this.prisma.attachment.count({ where: { uploaderId: userId, createdAt: { gte: dayStart } } });
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'attachmentsPerDay.max', today);

    const id = randomUUID();
    const safeName = input.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
    const key = `attachments/${task.workspaceId}/${taskId}/${id}/${safeName}`;
    const attachment = await this.prisma.attachment.create({
      data: { id, taskId, uploaderId: userId, fileName: safeName, contentType: input.contentType, sizeBytes: input.sizeBytes, storageKey: key },
    });
    const upload = await this.storage.uploadUrl(id, key, input.contentType);
    return { attachment: this.toAttachmentDTO(attachment), upload: { method: 'PUT', ...upload } };
  }

  async completeAttachment(userId: string, attachmentId: string, sessionId?: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt || a.uploaderId !== userId) throw Errors.notFound('Attachment');
    const { task } = await this.access.task(userId, a.taskId, 'attachment.create');
    const size = await this.storage.size(a.storageKey);
    if (size === null) throw Errors.badRequest('Upload not found — try again', 'upload_missing');
    if (size > this.env.MAX_ATTACHMENT_BYTES) {
      await this.storage.remove(a.storageKey);
      throw Errors.badRequest('File too large', 'file_too_large');
    }
    const ready = await this.prisma.attachment.update({ where: { id: attachmentId }, data: { status: 'READY', sizeBytes: size } });
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'attached', entityType: 'task', entityId: task.id, projectId: task.projectId, data: { fileName: a.fileName } });
    await this.refresh(userId, task.id, sessionId);
    return this.toAttachmentDTO(ready);
  }

  async attachmentUrl(userId: string, attachmentId: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt || a.status !== 'READY') throw Errors.notFound('Attachment');
    await this.access.task(userId, a.taskId, 'task.read');
    return { url: await this.storage.downloadUrl(a.id, a.storageKey, a.fileName), expiresInSeconds: 300 };
  }

  async deleteAttachment(userId: string, attachmentId: string) {
    const a = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt) throw Errors.notFound('Attachment');
    const { task } = await this.access.task(userId, a.taskId, a.uploaderId === userId ? 'attachment.create' : 'attachment.delete');
    await this.prisma.attachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
    await this.storage.remove(a.storageKey);
    await this.audit.log({ action: 'attachment.deleted', actorId: userId, workspaceId: task.workspaceId, targetType: 'attachment', targetId: attachmentId });
    await this.refresh(userId, a.taskId);
    return { ok: true };
  }

  async taskActivity(userId: string, taskId: string) {
    await this.access.task(userId, taskId, 'task.read', { includeDeleted: true });
    return this.activity.list(userId, { entityType: 'task', entityId: taskId });
  }
}
