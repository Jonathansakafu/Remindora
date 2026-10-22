import { Injectable } from '@nestjs/common';
import { can, type Permission } from '@remindora/auth';
import type { Role } from '@remindora/types';
import { AuditService } from './audit.service';
import { Errors } from './errors';
import { PrismaService } from './prisma.service';

export interface AccessGrant {
  workspaceId: string;
  role: Role;
  isPersonal: boolean;
  ownerId: string;
}

/**
 * RBAC enforcement. Every workspace-scoped endpoint resolves the target's
 * workspace and asserts a permission here. Denials are audit-logged. Resources
 * the user can't see at all return 404 (not 403) to avoid leaking existence.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async workspace(userId: string, workspaceId: string, permission: Permission): Promise<AccessGrant> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: { select: { isPersonal: true, ownerId: true, deletedAt: true } } },
    });
    if (!membership || membership.workspace.deletedAt) throw Errors.notFound('Workspace');
    if (!can(membership.role, permission)) {
      await this.audit.log({ action: `denied:${permission}`, actorId: userId, workspaceId, outcome: 'denied' });
      throw Errors.forbidden();
    }
    return { workspaceId, role: membership.role, isPersonal: membership.workspace.isPersonal, ownerId: membership.workspace.ownerId };
  }

  async project(userId: string, projectId: string, permission: Permission, opts: { includeDeleted?: boolean } = {}) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || (project.deletedAt && !opts.includeDeleted)) throw Errors.notFound('Project');
    const grant = await this.workspace(userId, project.workspaceId, permission);
    return { project, grant };
  }

  async task(userId: string, taskId: string, permission: Permission, opts: { includeDeleted?: boolean } = {}) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || (task.deletedAt && !opts.includeDeleted)) throw Errors.notFound('Task');
    const grant = await this.workspace(userId, task.workspaceId, permission);
    return { task, grant };
  }

  /** Workspaces the user belongs to (for list queries and realtime rooms). */
  async workspaceIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({ where: { userId, workspace: { deletedAt: null } }, select: { workspaceId: true } });
    return rows.map((r) => r.workspaceId);
  }

  async personalWorkspace(userId: string) {
    const ws = await this.prisma.workspace.findFirst({ where: { ownerId: userId, isPersonal: true, deletedAt: null } });
    if (!ws) throw Errors.notFound('Personal workspace');
    return ws;
  }

  async inbox(userId: string) {
    const ws = await this.personalWorkspace(userId);
    const inbox = await this.prisma.project.findFirst({ where: { workspaceId: ws.id, isInbox: true, deletedAt: null } });
    if (!inbox) throw Errors.notFound('Inbox');
    return inbox;
  }
}
