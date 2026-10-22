import { Injectable } from '@nestjs/common';
import type { Prisma, Project, Section } from '@remindora/database';
import type { ProjectDTO } from '@remindora/types';
import { AccessService } from '../../common/access.service';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityService } from '../activity/activity.service';


type ProjectWithExtras = Project & { sections: Section[]; _count?: { tasks: number } };

export function toProjectDTO(p: ProjectWithExtras, taskCount?: number): ProjectDTO {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    folderId: p.folderId,
    name: p.name,
    color: p.color,
    icon: p.icon,
    isInbox: p.isInbox,
    defaultView: p.defaultView,
    archived: p.archived,
    sortOrder: p.sortOrder,
    taskCount: taskCount ?? p._count?.tasks ?? 0,
    sections: p.sections.filter((s) => !s.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ id: s.id, projectId: s.projectId, name: s.name, sortOrder: s.sortOrder })),
  };
}

const openTasks = { where: { deletedAt: null, completedAt: null, archived: false, parentId: null } } as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string, workspaceId?: string, includeArchived = false): Promise<ProjectDTO[]> {
    const ids = workspaceId ? [(await this.access.workspace(userId, workspaceId, 'project.read')).workspaceId] : await this.access.workspaceIds(userId);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId: { in: ids }, deletedAt: null, ...(includeArchived ? {} : { archived: false }) },
      include: { sections: { where: { deletedAt: null } }, _count: { select: { tasks: openTasks } } },
      orderBy: [{ isInbox: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((p) => toProjectDTO(p));
  }

  async get(userId: string, id: string) {
    const { project } = await this.access.project(userId, id, 'project.read');
    const full = await this.prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: { sections: true, _count: { select: { tasks: openTasks } } } });
    return toProjectDTO(full);
  }

  /** Lists are counted across every workspace the user owns (plan limit `lists.max`). */
  private async assertListLimit(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerId: true } });
    const ent = await this.entitlements.forUser(ws.ownerId);
    const count = await this.prisma.project.count({ where: { workspace: { ownerId: ws.ownerId, deletedAt: null }, deletedAt: null, isInbox: false } });
    await this.entitlements.assertLimit(ent, 'lists.max', count);
  }

  async create(
    userId: string,
    input: { workspaceId?: string; name: string; color?: string; icon?: string | null; folderId?: string | null; defaultView?: string; sections?: string[] },
    originSessionId?: string,
  ): Promise<ProjectDTO> {
    const workspaceId = input.workspaceId ?? (await this.access.personalWorkspace(userId)).id;
    await this.access.workspace(userId, workspaceId, 'project.create');
    await this.assertListLimit(workspaceId);
    if (input.defaultView === 'TIMELINE') await this.entitlements.assertFeature(userId, 'view.timeline');
    if (input.folderId) {
      const folder = await this.prisma.folder.findUnique({ where: { id: input.folderId } });
      if (!folder || folder.workspaceId !== workspaceId) throw Errors.badRequest('Folder belongs to a different workspace');
    }
    const max = await this.prisma.project.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
    const project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId,
          name: input.name,
          color: input.color ?? '#60E9FF',
          icon: input.icon ?? null,
          folderId: input.folderId ?? null,
          defaultView: input.defaultView ?? 'LIST',
          createdById: userId,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          sections: input.sections?.length ? { create: input.sections.map((name, i) => ({ name, sortOrder: i })) } : undefined,
        },
        include: { sections: true },
      });
      await this.activity.record({ workspaceId, actorId: userId, verb: 'created', entityType: 'project', entityId: p.id, projectId: p.id, data: { name: p.name } }, tx);
      await this.audit.log({ action: 'project.created', actorId: userId, workspaceId, targetType: 'project', targetId: p.id }, tx);
      return p;
    });
    const dto = toProjectDTO(project, 0);
    this.realtime.toWorkspace(workspaceId, 'project.upserted', { project: dto, originSessionId });
    return dto;
  }

  async update(
    userId: string,
    id: string,
    data: Partial<{ name: string; color: string; icon: string | null; folderId: string | null; defaultView: string; archived: boolean; sortOrder: number }>,
    originSessionId?: string,
  ) {
    const { project } = await this.access.project(userId, id, 'project.update');
    if (project.isInbox && (data.archived || data.name)) throw Errors.badRequest('The Inbox cannot be renamed or archived');
    if (data.defaultView === 'TIMELINE') await this.entitlements.assertFeature(userId, 'view.timeline');
    if (data.folderId) {
      const folder = await this.prisma.folder.findUnique({ where: { id: data.folderId } });
      if (!folder || folder.workspaceId !== project.workspaceId) throw Errors.badRequest('Folder belongs to a different workspace');
    }
    const updated = await this.prisma.project.update({ where: { id }, data, include: { sections: true, _count: { select: { tasks: openTasks } } } });
    await this.activity.record({ workspaceId: project.workspaceId, actorId: userId, verb: data.archived === true ? 'archived' : 'updated', entityType: 'project', entityId: id, projectId: id, data: { fields: Object.keys(data) } });
    await this.audit.log({ action: 'project.updated', actorId: userId, workspaceId: project.workspaceId, targetType: 'project', targetId: id, metadata: { fields: Object.keys(data) } });
    const dto = toProjectDTO(updated);
    this.realtime.toWorkspace(project.workspaceId, 'project.upserted', { project: dto, originSessionId });
    return dto;
  }

  async remove(userId: string, id: string, originSessionId?: string) {
    const { project } = await this.access.project(userId, id, 'project.delete');
    if (project.isInbox) throw Errors.badRequest('The Inbox cannot be deleted');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.project.update({ where: { id }, data: { deletedAt: now } }),
      this.prisma.task.updateMany({ where: { projectId: id, deletedAt: null }, data: { deletedAt: now } }),
    ]);
    await this.audit.log({ action: 'project.deleted', actorId: userId, workspaceId: project.workspaceId, targetType: 'project', targetId: id });
    this.realtime.toWorkspace(project.workspaceId, 'project.deleted', { projectId: id, originSessionId });
    return { ok: true };
  }

  async restore(userId: string, id: string) {
    const { project } = await this.access.project(userId, id, 'project.delete', { includeDeleted: true });
    if (!project.deletedAt) return this.get(userId, id);
    await this.assertListLimit(project.workspaceId);
    await this.prisma.$transaction([
      this.prisma.project.update({ where: { id }, data: { deletedAt: null } }),
      this.prisma.task.updateMany({ where: { projectId: id, deletedAt: project.deletedAt }, data: { deletedAt: null } }),
    ]);
    await this.audit.log({ action: 'project.restored', actorId: userId, workspaceId: project.workspaceId, targetType: 'project', targetId: id });
    return this.get(userId, id);
  }

  async createSection(userId: string, projectId: string, name: string) {
    const { project } = await this.access.project(userId, projectId, 'project.update');
    const max = await this.prisma.section.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const s = await this.prisma.section.create({ data: { projectId, name, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await this.touch(project.id, project.workspaceId);
    return { id: s.id, projectId, name: s.name, sortOrder: s.sortOrder };
  }

  async updateSection(userId: string, sectionId: string, data: { name?: string; sortOrder?: number }) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!section || section.deletedAt) throw Errors.notFound('Section');
    const { project } = await this.access.project(userId, section.projectId, 'project.update');
    await this.prisma.section.update({ where: { id: sectionId }, data });
    await this.touch(project.id, project.workspaceId);
    return { ok: true };
  }

  async deleteSection(userId: string, sectionId: string) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId } });
    if (!section || section.deletedAt) throw Errors.notFound('Section');
    const { project } = await this.access.project(userId, section.projectId, 'project.update');
    await this.prisma.$transaction([
      this.prisma.task.updateMany({ where: { sectionId }, data: { sectionId: null } }),
      this.prisma.section.update({ where: { id: sectionId }, data: { deletedAt: new Date() } }),
    ]);
    await this.touch(project.id, project.workspaceId);
    return { ok: true };
  }

  /** Bumps the project's syncSeq and broadcasts it (sections changed). */
  private async touch(projectId: string, workspaceId: string) {
    const p = await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() }, include: { sections: true, _count: { select: { tasks: openTasks } } } });
    this.realtime.toWorkspace(workspaceId, 'project.upserted', { project: toProjectDTO(p) });
  }

  async activityFor(userId: string, projectId: string) {
    await this.access.project(userId, projectId, 'project.read');
    return this.activity.list(userId, { projectId } as Prisma.ActivityEventWhereInput);
  }
}
