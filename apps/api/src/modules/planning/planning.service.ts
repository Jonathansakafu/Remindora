import { Injectable } from '@nestjs/common';
import { occurrencesBetween } from '@remindora/core';
import type { Prisma } from '@remindora/database';
import { filterQuery, type FilterQuery, type SavedFilterDTO, type TemplateDTO } from '@remindora/types';
import { AccessService } from '../../common/access.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { taskInclude, toTaskDTO } from '../tasks/task.mapper';
import { TasksService } from '../tasks/tasks.service';
import { compileFilter, isAdvancedFilter } from './filters';

const PREMIUM_CALENDAR_VIEWS = new Set(['day', '3day', 'multiweek', 'year']);

@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly entitlements: EntitlementsService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  // ── Calendar ──

  async calendar(userId: string, opts: { from: Date; to: Date; view?: string; projectId?: string }) {
    if (opts.view && PREMIUM_CALENDAR_VIEWS.has(opts.view)) await this.entitlements.assertFeature(userId, 'view.calendarMulti');
    if (opts.to.getTime() - opts.from.getTime() > 400 * 86_400_000) throw Errors.badRequest('Range too large (max ~13 months)');
    const ids = await this.access.workspaceIds(userId);
    const personal = await this.access.personalWorkspace(userId);
    const scope: Prisma.TaskWhereInput = opts.projectId
      ? { projectId: (await this.access.project(userId, opts.projectId, 'task.read')).project.id }
      : { workspaceId: { in: ids }, OR: [{ workspaceId: personal.id }, { assigneeId: userId }] };
    const range = { gte: opts.from, lte: opts.to };
    const rows = await this.prisma.task.findMany({
      where: { AND: [scope, { deletedAt: null, archived: false }, { OR: [{ dueAt: range }, { startAt: range }] }] },
      include: taskInclude(userId),
      orderBy: { dueAt: 'asc' },
      take: 2000,
    });

    // Project future occurrences of open repeating tasks as read-only ghosts.
    const recurring = await this.prisma.task.findMany({
      where: { AND: [scope, { deletedAt: null, archived: false, completedAt: null, recurrenceId: { not: null }, dueAt: { lte: opts.to } }] },
      include: { recurrence: true },
      take: 500,
    });
    const occurrences: Array<{ taskId: string; at: string }> = [];
    for (const t of recurring) {
      if (!t.recurrence || !t.dueAt) continue;
      const occ = occurrencesBetween({ rrule: t.recurrence.rrule, dtstart: t.recurrence.dtstart, timezone: t.recurrence.timezone, until: t.recurrence.until }, opts.from, opts.to, 400);
      for (const at of occ) if (at.getTime() > t.dueAt.getTime()) occurrences.push({ taskId: t.id, at: at.toISOString() });
    }

    const events = await this.prisma.externalEvent.findMany({
      where: { subscription: { userId }, startAt: { lte: opts.to }, endAt: { gte: opts.from } },
      include: { subscription: { select: { name: true, color: true } } },
      orderBy: { startAt: 'asc' },
      take: 2000,
    });
    return {
      tasks: rows.map(toTaskDTO),
      occurrences,
      events: events.map((e) => ({ id: e.id, title: e.title, startAt: e.startAt.toISOString(), endAt: e.endAt.toISOString(), allDay: e.allDay, location: e.location, calendar: e.subscription.name, color: e.subscription.color })),
    };
  }

  // ── Search ──

  async search(userId: string, q: string) {
    const term = q.trim();
    if (!term) return { tasks: [], projects: [], tags: [] };
    const ids = await this.access.workspaceIds(userId);
    const [tasks, projects, tags] = await Promise.all([
      this.prisma.task.findMany({
        where: { workspaceId: { in: ids }, deletedAt: null, OR: [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, { tags: { some: { tag: { name: { contains: term.toLowerCase() } } } } }] },
        include: taskInclude(userId),
        orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'desc' }],
        take: 30,
      }),
      this.prisma.project.findMany({ where: { workspaceId: { in: ids }, deletedAt: null, name: { contains: term, mode: 'insensitive' } }, take: 10 }),
      this.prisma.tag.findMany({ where: { workspaceId: { in: ids }, name: { contains: term.toLowerCase() } }, take: 10 }),
    ]);
    return {
      tasks: tasks.map(toTaskDTO),
      projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color, workspaceId: p.workspaceId })),
      tags: [...new Set(tags.map((t) => t.name))],
    };
  }

  async tags(userId: string) {
    const ids = await this.access.workspaceIds(userId);
    const rows = await this.prisma.tag.findMany({ where: { workspaceId: { in: ids } }, include: { _count: { select: { tasks: true } } }, orderBy: { name: 'asc' } });
    const merged = new Map<string, { name: string; color: string; count: number }>();
    for (const t of rows) {
      const prev = merged.get(t.name);
      merged.set(t.name, { name: t.name, color: prev?.color ?? t.color, count: (prev?.count ?? 0) + t._count.tasks });
    }
    return [...merged.values()];
  }

  // ── Saved filters ──

  private toFilterDTO(f: { id: string; name: string; query: unknown; advanced: boolean; pinned: boolean }): SavedFilterDTO {
    return { id: f.id, name: f.name, query: f.query, advanced: f.advanced, pinned: f.pinned };
  }

  async filters(userId: string) {
    const rows = await this.prisma.savedFilter.findMany({ where: { userId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'asc' }] });
    return rows.map((f) => this.toFilterDTO(f));
  }

  async createFilter(userId: string, input: { name: string; query: FilterQuery; pinned?: boolean }) {
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'savedFilters.max', await this.prisma.savedFilter.count({ where: { userId } }));
    const advanced = isAdvancedFilter(input.query);
    if (advanced && !ent.features['filters.advanced']) throw Errors.planFeature('filters.advanced');
    const f = await this.prisma.savedFilter.create({ data: { userId, name: input.name, query: input.query as Prisma.InputJsonValue, advanced, pinned: input.pinned ?? false } });
    return this.toFilterDTO(f);
  }

  async updateFilter(userId: string, id: string, input: { name?: string; query?: FilterQuery; pinned?: boolean }) {
    const existing = await this.prisma.savedFilter.findFirst({ where: { id, userId } });
    if (!existing) throw Errors.notFound('Filter');
    let advanced = existing.advanced;
    if (input.query) {
      advanced = isAdvancedFilter(input.query);
      if (advanced) await this.entitlements.assertFeature(userId, 'filters.advanced');
    }
    const f = await this.prisma.savedFilter.update({ where: { id }, data: { name: input.name, pinned: input.pinned, advanced, ...(input.query ? { query: input.query as Prisma.InputJsonValue } : {}) } });
    return this.toFilterDTO(f);
  }

  async deleteFilter(userId: string, id: string) {
    const res = await this.prisma.savedFilter.deleteMany({ where: { id, userId } });
    if (!res.count) throw Errors.notFound('Filter');
    return { ok: true };
  }

  async runFilter(userId: string, idOrQuery: string | FilterQuery) {
    let query: FilterQuery;
    if (typeof idOrQuery === 'string') {
      const f = await this.prisma.savedFilter.findFirst({ where: { id: idOrQuery, userId } });
      if (!f) throw Errors.notFound('Filter');
      query = filterQuery.parse(f.query);
      if (f.advanced) await this.entitlements.assertFeature(userId, 'filters.advanced');
    } else {
      query = idOrQuery;
      if (isAdvancedFilter(query)) await this.entitlements.assertFeature(userId, 'filters.advanced');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ids = await this.access.workspaceIds(userId);
    const includesDone = query.rules.some((r) => r.field === 'status' && r.op === 'in' && r.value.includes('DONE'));
    const rows = await this.prisma.task.findMany({
      where: { AND: [{ workspaceId: { in: ids }, deletedAt: null, archived: false, ...(includesDone ? {} : { completedAt: null }) }, compileFilter(query, { userId, timezone: user.timezone })] },
      include: taskInclude(userId),
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
      take: 500,
    });
    return rows.map(toTaskDTO);
  }

  // ── Templates ──

  private toTemplateDTO(t: { id: string; kind: 'TASK' | 'PROJECT'; name: string; description: string | null; payload: unknown }): TemplateDTO {
    return { id: t.id, kind: t.kind, name: t.name, description: t.description, payload: t.payload };
  }

  async templates(userId: string) {
    const rows = await this.prisma.template.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map((t) => this.toTemplateDTO(t));
  }

  async createTemplate(userId: string, input: { kind: 'TASK' | 'PROJECT'; name: string; description?: string | null; payload: Record<string, unknown> }) {
    const ent = await this.entitlements.assertFeature(userId, 'templates.custom');
    await this.entitlements.assertLimit(ent, 'templates.max', await this.prisma.template.count({ where: { userId } }));
    const t = await this.prisma.template.create({ data: { userId, kind: input.kind, name: input.name, description: input.description ?? null, payload: input.payload as Prisma.InputJsonValue } });
    return this.toTemplateDTO(t);
  }

  /** Saves an existing task (with checklist) or list (with sections and open tasks) as a template. */
  async templateFrom(userId: string, input: { taskId?: string; projectId?: string; name: string }) {
    if (input.taskId) {
      const t = await this.tasks.get(userId, input.taskId);
      return this.createTemplate(userId, {
        kind: 'TASK',
        name: input.name,
        payload: { title: t.title, description: t.description, priority: t.priority, tags: t.tags, durationMinutes: t.durationMinutes, checklist: t.subtasks.map((s) => s.title) },
      });
    }
    if (!input.projectId) throw Errors.badRequest('taskId or projectId is required');
    const p = await this.projects.get(userId, input.projectId);
    const open = await this.tasks.query(userId, { projectId: p.id, limit: 200 });
    const sectionName = new Map(p.sections.map((s) => [s.id, s.name]));
    return this.createTemplate(userId, {
      kind: 'PROJECT',
      name: input.name,
      payload: {
        name: p.name,
        color: p.color,
        defaultView: p.defaultView,
        sections: p.sections.map((s) => s.name),
        tasks: open.map((t) => ({ title: t.title, priority: t.priority, section: t.sectionId ? sectionName.get(t.sectionId) : undefined, checklist: t.subtasks.map((s) => s.title), tags: t.tags })),
      },
    });
  }

  async deleteTemplate(userId: string, id: string) {
    const res = await this.prisma.template.deleteMany({ where: { id, userId } });
    if (!res.count) throw Errors.notFound('Template');
    return { ok: true };
  }

  async applyTemplate(ctx: { userId: string; sessionId?: string; deviceId?: string }, id: string, opts: { projectId?: string; workspaceId?: string; dueAt?: string | null }) {
    const t = await this.prisma.template.findFirst({ where: { id, userId: ctx.userId } });
    if (!t) throw Errors.notFound('Template');
    const p = t.payload as Record<string, unknown>;
    if (t.kind === 'TASK') {
      return this.tasks.create(ctx, {
        title: String(p.title ?? t.name),
        description: (p.description as string) ?? null,
        projectId: opts.projectId,
        priority: (p.priority as 'NONE') ?? 'NONE',
        status: 'TODO',
        tags: (p.tags as string[]) ?? [],
        dueAt: opts.dueAt ?? null,
        allDay: !!opts.dueAt,
        durationMinutes: (p.durationMinutes as number) ?? null,
        checklist: (p.checklist as string[]) ?? [],
        dependsOn: [],
        isFavorite: false,
      });
    }
    const project = await this.projects.create(ctx.userId, {
      workspaceId: opts.workspaceId,
      name: String(p.name ?? t.name),
      color: (p.color as string) ?? undefined,
      defaultView: (p.defaultView as string) ?? 'LIST',
      sections: (p.sections as string[]) ?? [],
    });
    const sectionId = new Map(project.sections.map((s) => [s.name, s.id]));
    for (const task of (p.tasks as Array<Record<string, unknown>>) ?? []) {
      await this.tasks.create(ctx, {
        title: String(task.title),
        projectId: project.id,
        sectionId: task.section ? (sectionId.get(String(task.section)) ?? null) : null,
        priority: (task.priority as 'NONE') ?? 'NONE',
        status: 'TODO',
        tags: (task.tags as string[]) ?? [],
        allDay: false,
        checklist: (task.checklist as string[]) ?? [],
        dependsOn: [],
        isFavorite: false,
      });
    }
    return this.projects.get(ctx.userId, project.id);
  }
}
