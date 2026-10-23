import { Injectable } from '@nestjs/common';
import { mergePatch, nextOccurrence, parseQuickAdd, smartListRange, validateRRule, type FieldVersions } from '@remindora/core';
import type { Prisma, Task } from '@remindora/database';
import type { CreateTaskInput, TaskDTO, TaskQueryInput, UpdateTaskInput } from '@remindora/types';
import sanitizeHtml from 'sanitize-html';
import { AccessService } from '../../common/access.service';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../../queues/queue.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReminderScheduler } from './reminder-scheduler.service';
import { taskInclude, toTaskDTO } from './task.mapper';

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'hr', 'span', 'div', 'input', 'label'],
  allowedAttributes: { a: ['href', 'target', 'rel'], input: ['type', 'checked', 'disabled'], li: ['data-checked', 'data-type'], ul: ['data-type'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
};

export function cleanDescription(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  const out = sanitizeHtml(html, SANITIZE).trim();
  return out.length ? out : null;
}

interface Ctx {
  userId: string;
  sessionId?: string;
  deviceId?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly scheduler: ReminderScheduler,
    private readonly notifications: NotificationsService,
    private readonly queues: QueueService,
  ) {}

  private async user(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async load(userId: string, id: string): Promise<TaskDTO> {
    const row = await this.prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude(userId) });
    return toTaskDTO(row);
  }

  private broadcast(task: TaskDTO, originSessionId?: string) {
    this.realtime.toWorkspace(task.workspaceId, 'task.upserted', { task, originSessionId });
  }

  // ───────────── Queries ─────────────

  async query(userId: string, q: TaskQueryInput): Promise<TaskDTO[]> {
    const user = await this.user(userId);
    const now = new Date();
    const workspaceIds = q.workspaceId ? [(await this.access.workspace(userId, q.workspaceId, 'task.read')).workspaceId] : await this.access.workspaceIds(userId);
    const personal = await this.access.personalWorkspace(userId);

    const where: Prisma.TaskWhereInput = { workspaceId: { in: workspaceIds }, deletedAt: null, archived: false, parentId: null };
    const open: Prisma.TaskWhereInput = { completedAt: null };
    // Smart lists across workspaces show your personal tasks plus shared tasks assigned to you.
    const mine: Prisma.TaskWhereInput = { OR: [{ workspaceId: personal.id }, { assigneeId: userId }] };
    let orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { sortOrder: 'asc' }];

    if (q.projectId) {
      await this.access.project(userId, q.projectId, 'task.read');
      where.projectId = q.projectId;
      orderBy = [{ sortOrder: 'asc' }, { createdAt: 'asc' }];
    }

    switch (q.view) {
      case 'inbox': {
        const inbox = await this.access.inbox(userId);
        Object.assign(where, open, { projectId: inbox.id });
        orderBy = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
        break;
      }
      case 'today': {
        const r = smartListRange('today', now, user.timezone);
        Object.assign(where, open, mine, { dueAt: { lte: r.to! } });
        break;
      }
      case 'upcoming': {
        const r = smartListRange('upcoming', now, user.timezone);
        Object.assign(where, open, mine, { dueAt: { gte: r.from!, lte: r.to! } });
        break;
      }
      case 'overdue': {
        const startOfToday = smartListRange('upcoming', now, user.timezone).from!;
        const sod = new Date(startOfToday.getTime() - 86_400_000);
        Object.assign(where, open, { AND: [mine, { OR: [{ allDay: false, dueAt: { lt: now } }, { allDay: true, dueAt: { lt: sod } }] }] });
        break;
      }
      case 'assigned':
        Object.assign(where, open, { assigneeId: userId });
        break;
      case 'completed':
        where.completedAt = { not: null };
        orderBy = [{ completedAt: 'desc' }];
        break;
      case 'favorites':
        Object.assign(where, { favorites: { some: { userId } } });
        if (!q.includeCompleted) Object.assign(where, open);
        break;
      case 'archive':
        where.archived = true;
        orderBy = [{ updatedAt: 'desc' }];
        break;
      case 'trash':
        where.deletedAt = { not: null };
        orderBy = [{ deletedAt: 'desc' }];
        break;
      default:
        if (!q.includeCompleted && !q.from) Object.assign(where, open);
    }

    if (q.q) {
      const and = (where.AND as Prisma.TaskWhereInput[] | undefined) ?? [];
      where.AND = [...and, { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }];
    }
    if (q.tags?.length) where.tags = { some: { tag: { name: { in: q.tags.map((t) => t.toLowerCase()) } } } };
    if (q.priorities?.length) where.priority = { in: q.priorities as Task['priority'][] };
    if (q.assigneeId) where.assigneeId = q.assigneeId;
    if (q.from || q.to) {
      const and = (where.AND as Prisma.TaskWhereInput[] | undefined) ?? [];
      const range = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
      where.AND = [...and, { OR: [{ dueAt: range }, { startAt: range }] }];
    }

    const rows = await this.prisma.task.findMany({ where, include: taskInclude(userId), orderBy, take: q.limit });
    return rows.map(toTaskDTO);
  }

  async children(userId: string, parentId: string) {
    await this.access.task(userId, parentId, 'task.read');
    const rows = await this.prisma.task.findMany({ where: { parentId, deletedAt: null }, include: taskInclude(userId), orderBy: { sortOrder: 'asc' } });
    return rows.map(toTaskDTO);
  }

  async get(userId: string, id: string): Promise<TaskDTO> {
    await this.access.task(userId, id, 'task.read', { includeDeleted: true });
    return this.load(userId, id);
  }

  // ───────────── Create ─────────────

  async create(ctx: Ctx, input: CreateTaskInput & { projectName?: string | null; assigneeHandle?: string | null }): Promise<TaskDTO> {
    const { userId } = ctx;
    if (input.clientId) {
      const existing = await this.prisma.task.findUnique({ where: { clientId: input.clientId } });
      if (existing) {
        if (existing.creatorId !== userId) throw Errors.conflict('Client id already used');
        return this.load(userId, existing.id); // Idempotent replay from an offline outbox.
      }
    }

    const user = await this.user(userId);
    const project = input.projectId
      ? (await this.access.project(userId, input.projectId, 'task.create')).project
      : input.projectName
        ? await this.findProjectByName(userId, input.projectName)
        : await this.access.inbox(userId);
    if (!input.projectId) await this.access.workspace(userId, project.workspaceId, 'task.create');

    const [ownerEnt, myEnt] = await Promise.all([this.entitlements.forWorkspaceOwner(project.workspaceId), this.entitlements.forUser(userId)]);
    const inList = await this.prisma.task.count({ where: { projectId: project.id, deletedAt: null } });
    await this.entitlements.assertLimit(ownerEnt, 'tasksPerList.max', inList);
    await this.entitlements.assertLimit(myEnt, 'checklistItemsPerTask.max', 0, input.checklist.length);
    if (input.durationMinutes && !myEnt.features['task.duration']) throw Errors.planFeature('task.duration');

    let parent: Task | null = null;
    if (input.parentId) {
      parent = (await this.access.task(userId, input.parentId, 'task.create')).task;
      if (parent.workspaceId !== project.workspaceId) throw Errors.badRequest('Parent task is in a different workspace');
    }

    let assigneeId = input.assigneeId ?? null;
    if (!assigneeId && input.assigneeHandle) assigneeId = await this.resolveAssignee(project.workspaceId, input.assigneeHandle);
    if (assigneeId) await this.assertAssignable(userId, project.workspaceId, assigneeId);

    const reminders = input.reminders ?? this.defaultReminders(input);
    await this.entitlements.assertLimit(myEnt, 'remindersPerTask.max', 0, reminders.length);
    if (reminders.some((r) => r.constant) && !myEnt.features['reminders.constant']) throw Errors.planFeature('reminders.constant');

    if (input.recurrence && !validateRRule(input.recurrence.rrule)) throw Errors.badRequest('Invalid repeat rule', 'invalid_rrule');
    if (input.recurrence && !input.dueAt) throw Errors.badRequest('Repeating tasks need a due date', 'recurrence_needs_due');
    if (input.sectionId) await this.assertSection(input.sectionId, project.id);
    if (input.dependsOn.length) await this.assertDependencies(project.workspaceId, null, input.dependsOn);

    const maxOrder = await this.prisma.task.aggregate({ where: { projectId: project.id, sectionId: input.sectionId ?? null }, _max: { sortOrder: true } });
    const tagIds = await this.upsertTags(project.workspaceId, input.tags);

    const task = await this.prisma.$transaction(async (tx) => {
      const recurrence = input.recurrence
        ? await tx.recurrenceRule.create({
            data: { rrule: input.recurrence.rrule, mode: input.recurrence.mode, dtstart: new Date(input.dueAt!), until: input.recurrence.until ? new Date(input.recurrence.until) : null, timezone: user.timezone },
          })
        : null;
      const t = await tx.task.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: project.id,
          sectionId: input.sectionId ?? null,
          parentId: parent?.id ?? null,
          title: input.title,
          description: cleanDescription(input.description),
          priority: input.priority as Task['priority'],
          status: input.status as Task['status'],
          creatorId: userId,
          assigneeId,
          startAt: input.startAt ? new Date(input.startAt) : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          allDay: input.allDay,
          durationMinutes: input.durationMinutes ?? null,
          completedAt: input.status === 'DONE' ? new Date() : null,
          completedById: input.status === 'DONE' ? userId : null,
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
          recurrenceId: recurrence?.id,
          clientId: input.clientId,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
          subtasks: { create: input.checklist.map((title, i) => ({ title, sortOrder: i })) },
          dependencies: { create: input.dependsOn.map((dependsOnId) => ({ dependsOnId })) },
          favorites: input.isFavorite ? { create: { userId } } : undefined,
        },
      });
      if (recurrence) await tx.task.update({ where: { id: t.id }, data: { seriesId: t.id } });
      const recipient = assigneeId ?? userId;
      for (const r of reminders) {
        await tx.reminder.create({
          data: { taskId: t.id, userId: recipient, offsetMinutes: r.at ? null : (r.offsetMinutes ?? 0), at: r.at ? new Date(r.at) : null, constant: r.constant ?? false },
        });
      }
      await this.activity.record({ workspaceId: t.workspaceId, actorId: userId, verb: 'created', entityType: 'task', entityId: t.id, projectId: t.projectId, data: { title: t.title } }, tx);
      return t;
    });

    await this.scheduler.rescheduleTask(task.id);
    if (assigneeId && assigneeId !== userId) await this.notifyAssigned(userId, assigneeId, task);
    const dto = await this.load(userId, task.id);
    this.broadcast(dto, ctx.sessionId);
    await this.queues.webhook({ userId, event: 'task.created', payload: { task: dto } });
    return dto;
  }

  /**
   * Defaults so reminders work without manual setup: a task with a time is reminded at
   * that time (any priority); an all-day task only when it's high priority or above.
   */
  private defaultReminders(input: CreateTaskInput): NonNullable<CreateTaskInput['reminders']> {
    if (!input.dueAt) return [];
    if (!input.allDay) return [{ offsetMinutes: 0 }];
    const rank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[input.priority as 'NONE'];
    return rank >= 3 ? [{ offsetMinutes: 0 }] : [];
  }

  private async findProjectByName(userId: string, name: string) {
    const ids = await this.access.workspaceIds(userId);
    const p = await this.prisma.project.findFirst({ where: { workspaceId: { in: ids }, deletedAt: null, name: { equals: name, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
    if (!p) throw Errors.badRequest(`No list named “${name}”`, 'unknown_project');
    return p;
  }

  private async resolveAssignee(workspaceId: string, handle: string): Promise<string | null> {
    const h = handle.toLowerCase();
    const members = await this.prisma.membership.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } });
    const match = members.find((m) => m.user.email.split('@')[0]!.toLowerCase() === h || (m.user.name ?? '').toLowerCase().split(' ')[0] === h || (m.user.name ?? '').toLowerCase().replace(/\s+/g, '') === h);
    return match?.user.id ?? null;
  }

  private async assertAssignable(actorId: string, workspaceId: string, assigneeId: string) {
    await this.access.workspace(actorId, workspaceId, 'task.assign');
    const member = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: assigneeId } } });
    if (!member) throw Errors.badRequest('Assignee is not a member of this workspace', 'invalid_assignee');
    if (member.role === 'VIEWER') throw Errors.badRequest('Viewers cannot be assigned tasks', 'invalid_assignee');
  }

  private async assertSection(sectionId: string, projectId: string) {
    const s = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!s || s.deletedAt || s.projectId !== projectId) throw Errors.badRequest('Section does not belong to this list', 'invalid_section');
  }

  /** Dependencies must be in the same workspace and must not form a cycle. */
  private async assertDependencies(workspaceId: string, taskId: string | null, dependsOn: string[]) {
    const deps = await this.prisma.task.findMany({ where: { id: { in: dependsOn } }, select: { id: true, workspaceId: true } });
    if (deps.length !== new Set(dependsOn).size || deps.some((d) => d.workspaceId !== workspaceId)) throw Errors.badRequest('Dependencies must be tasks in the same workspace', 'invalid_dependency');
    if (!taskId) return;
    if (dependsOn.includes(taskId)) throw Errors.badRequest('A task cannot depend on itself', 'dependency_cycle');
    // BFS over prerequisites; reaching `taskId` means a cycle.
    const seen = new Set<string>();
    let frontier = [...dependsOn];
    while (frontier.length) {
      const edges = await this.prisma.taskDependency.findMany({ where: { taskId: { in: frontier } }, select: { dependsOnId: true } });
      frontier = [];
      for (const e of edges) {
        if (e.dependsOnId === taskId) throw Errors.badRequest('That would create a dependency cycle', 'dependency_cycle');
        if (!seen.has(e.dependsOnId)) {
          seen.add(e.dependsOnId);
          frontier.push(e.dependsOnId);
        }
      }
    }
  }

  private async upsertTags(workspaceId: string, names: string[]): Promise<string[]> {
    const unique = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    const ids: string[] = [];
    for (const name of unique) {
      const tag = await this.prisma.tag.upsert({ where: { workspaceId_name: { workspaceId, name } }, create: { workspaceId, name }, update: {} });
      ids.push(tag.id);
    }
    return ids;
  }

  private async notifyAssigned(actorId: string, assigneeId: string, task: Task) {
    const actor = await this.user(actorId);
    await this.notifications.createInApp(assigneeId, {
      kind: 'ASSIGNMENT',
      priority: task.priority === 'NONE' ? 'MEDIUM' : task.priority,
      title: `${actor.name ?? actor.email} assigned you a task`,
      body: task.title,
      taskId: task.id,
      push: true,
      dedupeKey: `assign:${task.id}:${assigneeId}:${task.version}`,
    });
  }

  // ───────────── Update ─────────────

  async update(ctx: Ctx, id: string, input: UpdateTaskInput): Promise<TaskDTO> {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.update');
    const { baseVersion, force, ...patch } = input;
    if (Object.keys(patch).length === 0) return this.load(userId, id);

    if (patch.status === 'DONE' && !task.completedAt) {
      const rest = { ...patch };
      delete rest.status;
      if (Object.keys(rest).length) await this.update(ctx, id, { ...rest, baseVersion, force });
      return this.complete(ctx, id);
    }
    if (patch.status && patch.status !== 'DONE' && task.completedAt) await this.reopen(ctx, id);

    const current = await this.prisma.task.findUniqueOrThrow({ where: { id }, include: { tags: { include: { tag: true } }, recurrence: true, dependencies: true } });
    const values: Record<string, unknown> = {
      ...current,
      startAt: current.startAt?.toISOString() ?? null,
      dueAt: current.dueAt?.toISOString() ?? null,
      tags: current.tags.map((t) => t.tag.name).sort(),
      recurrence: current.recurrence ? { rrule: current.recurrence.rrule, mode: current.recurrence.mode, until: current.recurrence.until?.toISOString() ?? null } : null,
      dependsOn: current.dependencies.map((d) => d.dependsOnId).sort(),
    };
    const normalized: Record<string, unknown> = { ...patch };
    if (patch.tags) normalized.tags = [...new Set(patch.tags.map((t) => t.toLowerCase()))].sort();
    if (patch.dependsOn) normalized.dependsOn = [...patch.dependsOn].sort();
    if ('description' in patch) normalized.description = cleanDescription(patch.description);

    const merge = mergePatch(normalized, { version: current.version, fieldVersions: current.fieldVersions as FieldVersions, values }, baseVersion, force);
    const apply = merge.apply as Record<string, unknown>;

    // Validate what will actually be written.
    let targetWorkspace = current.workspaceId;
    if (apply.projectId && apply.projectId !== current.projectId) {
      const { project } = await this.access.project(userId, apply.projectId as string, 'task.create');
      const ent = await this.entitlements.forWorkspaceOwner(project.workspaceId);
      await this.entitlements.assertLimit(ent, 'tasksPerList.max', await this.prisma.task.count({ where: { projectId: project.id, deletedAt: null } }));
      targetWorkspace = project.workspaceId;
      if (!('sectionId' in apply)) apply.sectionId = null;
    }
    if (apply.sectionId) await this.assertSection(apply.sectionId as string, (apply.projectId as string) ?? current.projectId);
    if ('assigneeId' in apply && apply.assigneeId) await this.assertAssignable(userId, targetWorkspace, apply.assigneeId as string);
    if ('durationMinutes' in apply && apply.durationMinutes) await this.entitlements.assertFeature(userId, 'task.duration');
    if (apply.recurrence && !validateRRule((apply.recurrence as { rrule: string }).rrule)) throw Errors.badRequest('Invalid repeat rule', 'invalid_rrule');
    if (apply.dependsOn) await this.assertDependencies(targetWorkspace, id, apply.dependsOn as string[]);

    const user = await this.user(userId);
    const data: Prisma.TaskUncheckedUpdateInput = { version: merge.nextVersion, fieldVersions: merge.nextFieldVersions };
    for (const key of ['title', 'description', 'sectionId', 'priority', 'assigneeId', 'allDay', 'durationMinutes', 'archived', 'sortOrder'] as const) {
      if (key in apply) (data as Record<string, unknown>)[key] = apply[key];
    }
    if ('status' in apply) data.status = apply.status as Task['status'];
    if ('startAt' in apply) data.startAt = apply.startAt ? new Date(apply.startAt as string) : null;
    if ('dueAt' in apply) data.dueAt = apply.dueAt ? new Date(apply.dueAt as string) : null;
    if (apply.projectId) {
      data.projectId = apply.projectId as string;
      data.workspaceId = targetWorkspace;
    }

    await this.prisma.$transaction(async (tx) => {
      if ('tags' in apply || targetWorkspace !== current.workspaceId) {
        const names = (apply.tags as string[] | undefined) ?? (values.tags as string[]);
        const tagIds = await this.upsertTags(targetWorkspace, names);
        await tx.taskTag.deleteMany({ where: { taskId: id } });
        await tx.taskTag.createMany({ data: tagIds.map((tagId) => ({ taskId: id, tagId })) });
      }
      if ('recurrence' in apply) {
        const rec = apply.recurrence as { rrule: string; mode: 'FROM_DUE' | 'FROM_COMPLETION'; until?: string | null } | null;
        if (rec) {
          const due = (data.dueAt as Date | null | undefined) ?? current.dueAt;
          if (!due) throw Errors.badRequest('Repeating tasks need a due date', 'recurrence_needs_due');
          const r = await tx.recurrenceRule.create({ data: { rrule: rec.rrule, mode: rec.mode, dtstart: due, until: rec.until ? new Date(rec.until) : null, timezone: user.timezone } });
          data.recurrenceId = r.id;
          data.seriesId = current.seriesId ?? id;
        } else {
          data.recurrenceId = null;
        }
      }
      if ('dependsOn' in apply) {
        await tx.taskDependency.deleteMany({ where: { taskId: id } });
        await tx.taskDependency.createMany({ data: (apply.dependsOn as string[]).map((dependsOnId) => ({ taskId: id, dependsOnId })) });
      }
      if ('assigneeId' in apply) {
        // Reminders follow the assignee.
        await tx.reminder.updateMany({ where: { taskId: id }, data: { userId: (apply.assigneeId as string | null) ?? current.creatorId } });
      }
      await tx.task.update({ where: { id }, data });
      const changed = Object.keys(apply);
      if (changed.length) {
        await this.activity.record(
          {
            workspaceId: targetWorkspace,
            actorId: userId,
            verb: apply.projectId ? 'moved' : 'updated',
            entityType: 'task',
            entityId: id,
            projectId: (apply.projectId as string) ?? current.projectId,
            data: { fields: changed, ...(apply.priority ? { priority: { from: current.priority, to: apply.priority } } : {}), ...('dueAt' in apply ? { dueAt: { from: values.dueAt, to: apply.dueAt } } : {}) },
          },
          tx,
        );
      }
    });

    if (['dueAt', 'allDay', 'priority', 'assigneeId', 'archived'].some((k) => k in apply)) await this.scheduler.rescheduleTask(id);
    if (apply.assigneeId && apply.assigneeId !== userId && apply.assigneeId !== current.assigneeId) {
      await this.notifyAssigned(userId, apply.assigneeId as string, { ...current, version: merge.nextVersion });
    }
    if (targetWorkspace !== current.workspaceId) this.realtime.toWorkspace(current.workspaceId, 'task.deleted', { taskId: id, projectId: current.projectId, hard: false, originSessionId: ctx.sessionId });

    const dto = await this.load(userId, id);
    this.broadcast(dto, ctx.sessionId);
    if (merge.conflicts.length) throw Errors.conflict('Some fields were changed on another device', { fields: merge.conflicts, server: dto }, 'edit_conflict');
    await this.queues.webhook({ userId, event: 'task.updated', payload: { task: dto, fields: Object.keys(apply) } });
    return dto;
  }

  async setFavorite(userId: string, id: string, favorite: boolean) {
    await this.access.task(userId, id, 'task.read');
    if (favorite) await this.prisma.favorite.upsert({ where: { userId_taskId: { userId, taskId: id } }, create: { userId, taskId: id }, update: {} });
    else await this.prisma.favorite.deleteMany({ where: { userId, taskId: id } });
    return this.load(userId, id);
  }

  // ───────────── Complete / reopen ─────────────

  async complete(ctx: Ctx, id: string): Promise<TaskDTO> {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.update');
    if (task.completedAt) return this.load(userId, id);
    const now = new Date();

    const won = await this.prisma.task.updateMany({
      where: { id, completedAt: null },
      data: { completedAt: now, completedById: userId, status: 'DONE', version: { increment: 1 } },
    });
    if (!won.count) return this.load(userId, id);
    await this.prisma.reminder.updateMany({ where: { taskId: id, state: { in: ['ACTIVE', 'SNOOZED'] } }, data: { state: 'DONE', nextFireAt: null } });
    await this.notifications.resolveForTask(id, 'completed', ctx.deviceId ?? null);
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'completed', entityType: 'task', entityId: id, projectId: task.projectId });

    const next = await this.spawnNextOccurrence(userId, task, now);
    const dto = await this.load(userId, id);
    this.broadcast(dto, ctx.sessionId);
    if (next) this.broadcast(next, ctx.sessionId);
    await this.queues.webhook({ userId, event: 'task.completed', payload: { task: dto } });
    return dto;
  }

  /** Creates the next instance of a recurring task (subtasks reset, reminders carried over). */
  private async spawnNextOccurrence(userId: string, task: Task, completedAt: Date): Promise<TaskDTO | null> {
    if (!task.recurrenceId || !task.dueAt) return null;
    const rule = await this.prisma.recurrenceRule.findUnique({ where: { id: task.recurrenceId } });
    if (!rule) return null;
    const nextDue = nextOccurrence({ rrule: rule.rrule, dtstart: rule.dtstart, timezone: rule.timezone, mode: rule.mode, until: rule.until }, task.dueAt, completedAt);
    if (!nextDue) return null;
    const delta = nextDue.getTime() - task.dueAt.getTime();

    const full = await this.prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { tags: true, subtasks: true, reminders: true } });
    const created = await this.prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          workspaceId: full.workspaceId,
          projectId: full.projectId,
          sectionId: full.sectionId,
          title: full.title,
          description: full.description,
          priority: full.priority,
          creatorId: full.creatorId,
          assigneeId: full.assigneeId,
          dueAt: nextDue,
          startAt: full.startAt ? new Date(full.startAt.getTime() + delta) : null,
          allDay: full.allDay,
          durationMinutes: full.durationMinutes,
          sortOrder: full.sortOrder,
          recurrenceId: full.recurrenceId,
          seriesId: full.seriesId ?? full.id,
          tags: { create: full.tags.map((t) => ({ tagId: t.tagId })) },
          subtasks: { create: full.subtasks.map((s) => ({ title: s.title, sortOrder: s.sortOrder })) },
        },
      });
      for (const r of full.reminders.filter((r) => !r.subtaskId)) {
        await tx.reminder.create({
          data: { taskId: t.id, userId: r.userId, offsetMinutes: r.offsetMinutes, at: r.at ? new Date(r.at.getTime() + delta) : null, constant: r.constant },
        });
      }
      await this.activity.record({ workspaceId: t.workspaceId, actorId: userId, verb: 'recurred', entityType: 'task', entityId: t.id, projectId: t.projectId, data: { from: task.id } }, tx);
      return t;
    });
    await this.scheduler.rescheduleTask(created.id);
    return this.load(userId, created.id);
  }

  async reopen(ctx: Ctx, id: string): Promise<TaskDTO> {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.update');
    if (!task.completedAt) return this.load(userId, id);
    await this.prisma.task.update({ where: { id }, data: { completedAt: null, completedById: null, status: 'TODO', version: { increment: 1 } } });
    await this.prisma.reminder.updateMany({ where: { taskId: id, state: 'DONE' }, data: { state: 'ACTIVE' } });
    await this.scheduler.rescheduleTask(id);
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'reopened', entityType: 'task', entityId: id, projectId: task.projectId });
    const dto = await this.load(userId, id);
    this.broadcast(dto, ctx.sessionId);
    return dto;
  }

  // ───────────── Delete / restore ─────────────

  async remove(ctx: Ctx, id: string) {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.delete');
    const now = new Date();
    await this.prisma.task.updateMany({ where: { OR: [{ id }, { parentId: id }], deletedAt: null }, data: { deletedAt: now, version: { increment: 1 } } });
    await this.scheduler.rescheduleTask(id);
    await this.notifications.resolveForTask(id, 'stop', ctx.deviceId ?? null);
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'deleted', entityType: 'task', entityId: id, projectId: task.projectId });
    await this.audit.log({ action: 'task.deleted', actorId: userId, workspaceId: task.workspaceId, targetType: 'task', targetId: id });
    this.realtime.toWorkspace(task.workspaceId, 'task.deleted', { taskId: id, projectId: task.projectId, hard: false, originSessionId: ctx.sessionId });
    return { ok: true };
  }

  async restore(ctx: Ctx, id: string) {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.delete', { includeDeleted: true });
    if (!task.deletedAt) return this.load(userId, id);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: task.projectId } });
    if (project.deletedAt) throw Errors.badRequest('Restore the list first', 'project_deleted');
    await this.prisma.task.updateMany({ where: { OR: [{ id }, { parentId: id }], deletedAt: task.deletedAt }, data: { deletedAt: null, version: { increment: 1 } } });
    await this.prisma.reminder.updateMany({ where: { taskId: id, state: 'STOPPED' }, data: { state: 'ACTIVE' } });
    await this.scheduler.rescheduleTask(id);
    await this.activity.record({ workspaceId: task.workspaceId, actorId: userId, verb: 'restored', entityType: 'task', entityId: id, projectId: task.projectId });
    const dto = await this.load(userId, id);
    this.broadcast(dto, ctx.sessionId);
    return dto;
  }

  async purge(ctx: Ctx, id: string) {
    const { userId } = ctx;
    const { task } = await this.access.task(userId, id, 'task.delete', { includeDeleted: true });
    if (!task.deletedAt) throw Errors.badRequest('Move the task to Trash first', 'not_in_trash');
    await this.prisma.task.delete({ where: { id } });
    await this.audit.log({ action: 'task.purged', actorId: userId, workspaceId: task.workspaceId, targetType: 'task', targetId: id });
    this.realtime.toWorkspace(task.workspaceId, 'task.deleted', { taskId: id, projectId: task.projectId, hard: true, originSessionId: ctx.sessionId });
    return { ok: true };
  }

  async emptyTrash(ctx: Ctx) {
    const ids = await this.access.workspaceIds(ctx.userId);
    const trashed = await this.prisma.task.findMany({ where: { workspaceId: { in: ids }, deletedAt: { not: null } }, select: { id: true } });
    let purged = 0;
    for (const t of trashed) {
      try {
        await this.purge(ctx, t.id);
        purged++;
      } catch {
        // Skip tasks this user isn't allowed to purge.
      }
    }
    return { ok: true, purged };
  }

  // ───────────── Bulk, duplicate, quick add ─────────────

  async bulk(ctx: Ctx, input: { ids: string[]; action: string; projectId?: string; priority?: string; tag?: string }) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of input.ids) {
      try {
        switch (input.action) {
          case 'complete':
            await this.complete(ctx, id);
            break;
          case 'reopen':
            await this.reopen(ctx, id);
            break;
          case 'delete':
            await this.remove(ctx, id);
            break;
          case 'restore':
            await this.restore(ctx, id);
            break;
          case 'archive':
            await this.update(ctx, id, { archived: true, force: true });
            break;
          case 'move':
            if (!input.projectId) throw Errors.badRequest('projectId required');
            await this.update(ctx, id, { projectId: input.projectId, force: true });
            break;
          case 'priority':
            if (!input.priority) throw Errors.badRequest('priority required');
            await this.update(ctx, id, { priority: input.priority as Task['priority'], force: true });
            break;
          case 'tag': {
            if (!input.tag) throw Errors.badRequest('tag required');
            const t = await this.load(ctx.userId, id);
            await this.update(ctx, id, { tags: [...t.tags, input.tag], force: true });
            break;
          }
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as { response?: { code?: string } }).response?.code ?? 'failed' });
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length };
  }

  async duplicate(ctx: Ctx, id: string) {
    const t = await this.get(ctx.userId, id);
    return this.create(ctx, {
      title: `${t.title} (copy)`,
      description: t.description,
      projectId: t.projectId,
      sectionId: t.sectionId,
      priority: t.priority,
      status: 'TODO',
      tags: t.tags,
      assigneeId: t.assigneeId,
      startAt: t.startAt,
      dueAt: t.dueAt,
      allDay: t.allDay,
      durationMinutes: t.durationMinutes,
      recurrence: t.recurrence ? { rrule: t.recurrence.rrule, mode: t.recurrence.mode, until: t.recurrence.until } : null,
      reminders: t.reminders.filter((r) => !r.subtaskId).map((r) => ({ offsetMinutes: r.offsetMinutes ?? undefined, at: r.at ?? undefined, constant: r.constant })),
      checklist: t.subtasks.map((s) => s.title),
      dependsOn: [],
      isFavorite: false,
    });
  }

  async parse(userId: string, text: string) {
    const user = await this.user(userId);
    return parseQuickAdd(text, { timezone: user.timezone, weekStartsOn: user.weekStartsOn === 1 ? 1 : 7 });
  }

  async quickAdd(ctx: Ctx, text: string, projectId?: string) {
    const parsed = await this.parse(ctx.userId, text);
    const ent = await this.entitlements.forUser(ctx.userId);
    const canDuration = ent.features['task.duration'];
    const task = await this.create(ctx, {
      title: parsed.title,
      projectId,
      projectName: projectId ? null : parsed.projectName,
      assigneeHandle: parsed.assignee,
      priority: parsed.priority ?? 'NONE',
      status: 'TODO',
      tags: parsed.tags,
      dueAt: parsed.dueAt,
      startAt: canDuration ? parsed.startAt : null,
      allDay: parsed.allDay,
      durationMinutes: canDuration ? parsed.durationMinutes : null,
      recurrence: parsed.recurrence,
      reminders: parsed.reminderOffsets.length ? parsed.reminderOffsets.map((offsetMinutes) => ({ offsetMinutes })) : undefined,
      checklist: [],
      dependsOn: [],
      isFavorite: false,
    });
    return { task, parsed, dropped: !canDuration && parsed.durationMinutes ? ['duration'] : [] };
  }
}
