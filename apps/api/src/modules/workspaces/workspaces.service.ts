import { Inject, Injectable } from '@nestjs/common';
import { canChangeRole, canRemoveMember, randomToken, sha256 } from '@remindora/auth';
import { templates } from '@remindora/notifications';
import type { MemberDTO, Role, WorkspaceDTO } from '@remindora/types';
import { AccessService } from '../../common/access.service';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ENV, type ServerEnv } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';
import { ActivityService } from '../activity/activity.service';
import { AuthService } from '../auth/auth.service';

const INVITE_TTL_MS = 7 * 86_400_000;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async list(userId: string): Promise<WorkspaceDTO[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, workspace: { deletedAt: null } },
      include: { workspace: { include: { _count: { select: { memberships: true } } } } },
      orderBy: [{ workspace: { isPersonal: 'desc' } }, { createdAt: 'asc' }],
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      isPersonal: m.workspace.isPersonal,
      role: m.role,
      memberCount: m.workspace._count.memberships,
    }));
  }

  async create(userId: string, name: string) {
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'team'}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const ws = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name, slug, ownerId: userId, memberships: { create: { userId, role: 'OWNER' } } } });
      await this.audit.log({ action: 'workspace.created', actorId: userId, workspaceId: ws.id, targetType: 'workspace', targetId: ws.id }, tx);
      return ws;
    });
    this.realtime.joinWorkspace(userId, ws.id);
    return { id: ws.id, name: ws.name, slug: ws.slug, isPersonal: false, role: 'OWNER' as Role, memberCount: 1 };
  }

  async update(userId: string, id: string, name: string) {
    await this.access.workspace(userId, id, 'workspace.update');
    await this.prisma.workspace.update({ where: { id }, data: { name } });
    await this.audit.log({ action: 'workspace.updated', actorId: userId, workspaceId: id, targetType: 'workspace', targetId: id, metadata: { name } });
    return { ok: true };
  }

  async remove(userId: string, id: string) {
    const grant = await this.access.workspace(userId, id, 'workspace.delete');
    if (grant.isPersonal) throw Errors.badRequest('Your personal workspace cannot be deleted');
    await this.prisma.workspace.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ action: 'workspace.deleted', actorId: userId, workspaceId: id, targetType: 'workspace', targetId: id });
    return { ok: true };
  }

  async members(userId: string, id: string): Promise<MemberDTO[]> {
    await this.access.workspace(userId, id, 'workspace.read');
    const rows = await this.prisma.membership.findMany({ where: { workspaceId: id }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, role: m.role, joinedAt: m.createdAt.toISOString() }));
  }

  async changeRole(userId: string, id: string, targetUserId: string, next: Role) {
    const grant = await this.access.workspace(userId, id, 'member.role');
    const target = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } } });
    if (!target) throw Errors.notFound('Member');
    const ownerCount = await this.prisma.membership.count({ where: { workspaceId: id, role: 'OWNER' } });
    const verdict = canChangeRole({ actor: grant.role, target: target.role, next, isSelf: userId === targetUserId, ownerCount });
    if (!verdict.ok) {
      await this.audit.log({ action: 'member.role_denied', actorId: userId, workspaceId: id, targetType: 'user', targetId: targetUserId, outcome: 'denied', metadata: { reason: verdict.reason } });
      throw Errors.forbidden(verdict.reason);
    }
    await this.prisma.membership.update({ where: { id: target.id }, data: { role: next } });
    await this.audit.log({ action: 'member.role_changed', actorId: userId, workspaceId: id, targetType: 'user', targetId: targetUserId, metadata: { from: target.role, to: next } });
    await this.activity.record({ workspaceId: id, actorId: userId, verb: 'role_changed', entityType: 'member', entityId: targetUserId, data: { from: target.role, to: next } });
    return { ok: true };
  }

  async removeMember(userId: string, id: string, targetUserId: string) {
    const isSelf = userId === targetUserId;
    const grant = await this.access.workspace(userId, id, isSelf ? 'workspace.read' : 'member.remove');
    if (grant.isPersonal) throw Errors.badRequest('Personal workspaces have no other members');
    const target = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: targetUserId } } });
    if (!target) throw Errors.notFound('Member');
    const ownerCount = await this.prisma.membership.count({ where: { workspaceId: id, role: 'OWNER' } });
    const verdict = canRemoveMember({ actor: grant.role, target: target.role, isSelf, ownerCount });
    if (!verdict.ok) throw Errors.forbidden(verdict.reason);
    await this.prisma.$transaction([
      this.prisma.membership.delete({ where: { id: target.id } }),
      // Unassign their open tasks in this workspace.
      this.prisma.task.updateMany({ where: { workspaceId: id, assigneeId: targetUserId, completedAt: null }, data: { assigneeId: null } }),
    ]);
    this.realtime.leaveWorkspace(targetUserId, id);
    await this.audit.log({ action: isSelf ? 'member.left' : 'member.removed', actorId: userId, workspaceId: id, targetType: 'user', targetId: targetUserId });
    return { ok: true };
  }

  async invite(userId: string, id: string, email: string, role: Role) {
    const grant = await this.access.workspace(userId, id, 'member.invite');
    if (grant.isPersonal) throw Errors.badRequest('Create a shared workspace to invite people');
    if (role === 'OWNER') throw Errors.badRequest('Invite as admin, then transfer ownership');
    if (role === 'ADMIN' && grant.role !== 'OWNER') throw Errors.forbidden('Only owners can invite admins');

    const ent = await this.entitlements.forWorkspaceOwner(id);
    // "Members" are collaborators: everyone except the owner, plus pending invites.
    const [members, pending] = await Promise.all([
      this.prisma.membership.count({ where: { workspaceId: id, role: { not: 'OWNER' } } }),
      this.prisma.invite.count({ where: { workspaceId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    await this.entitlements.assertLimit(ent, 'members.max', members + pending);

    const existing = await this.prisma.membership.findFirst({ where: { workspaceId: id, user: { email } } });
    if (existing) throw Errors.conflict('Already a member');

    const token = randomToken(32);
    const invite = await this.prisma.invite.create({
      data: { workspaceId: id, email, role, tokenHash: sha256(token), invitedById: userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    const [ws, inviter] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    const link = `${this.env.WEB_URL}/invite?t=${token}`;
    await this.auth.email.send({ ...templates.invite(ws.name, inviter.name ?? inviter.email, link), to: email });
    const invitee = await this.prisma.user.findUnique({ where: { email } });
    if (invitee) {
      await this.prisma.notification.create({
        data: { userId: invitee.id, kind: 'INVITE', priority: 'MEDIUM', title: `Invitation to ${ws.name}`, body: `${inviter.name ?? inviter.email} invited you as ${role.toLowerCase()}.`, data: { inviteId: invite.id, token }, dedupeKey: `invite:${invite.id}` },
      });
    }
    await this.audit.log({ action: 'member.invited', actorId: userId, workspaceId: id, targetType: 'invite', targetId: invite.id, metadata: { email, role } });
    return { id: invite.id, email, role, expiresAt: invite.expiresAt.toISOString() };
  }

  async invites(userId: string, id: string) {
    await this.access.workspace(userId, id, 'member.invite');
    const rows = await this.prisma.invite.findMany({ where: { workspaceId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return rows.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }));
  }

  async revokeInvite(userId: string, workspaceId: string, inviteId: string) {
    await this.access.workspace(userId, workspaceId, 'member.invite');
    const res = await this.prisma.invite.updateMany({ where: { id: inviteId, workspaceId, acceptedAt: null }, data: { revokedAt: new Date() } });
    if (!res.count) throw Errors.notFound('Invite');
    await this.audit.log({ action: 'member.invite_revoked', actorId: userId, workspaceId, targetType: 'invite', targetId: inviteId });
    return { ok: true };
  }

  async accept(userId: string, token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true } });
    if (!invite || invite.revokedAt || invite.workspace.deletedAt) throw Errors.notFound('Invite');
    if (invite.acceptedAt) throw Errors.gone('Invite already used', 'invite_used');
    if (invite.expiresAt.getTime() <= Date.now()) throw Errors.gone('Invite expired', 'invite_expired');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== invite.email) throw Errors.forbidden(`This invite was sent to ${invite.email}`);
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (!won.count) throw Errors.gone('Invite already used', 'invite_used');
      await tx.membership.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
        create: { workspaceId: invite.workspaceId, userId, role: invite.role },
        update: {},
      });
      await this.audit.log({ action: 'member.joined', actorId: userId, workspaceId: invite.workspaceId, targetType: 'invite', targetId: invite.id }, tx);
    });
    this.realtime.joinWorkspace(userId, invite.workspaceId);
    await this.activity.record({ workspaceId: invite.workspaceId, actorId: userId, verb: 'joined', entityType: 'member', entityId: userId });
    return { workspaceId: invite.workspaceId, name: invite.workspace.name };
  }

  async auditLog(userId: string, id: string, limit: number) {
    await this.access.workspace(userId, id, 'workspace.audit');
    const rows = await this.prisma.auditLog.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  // ── Folders ──
  async folders(userId: string, workspaceId: string) {
    await this.access.workspace(userId, workspaceId, 'workspace.read');
    return this.prisma.folder.findMany({ where: { workspaceId, deletedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, workspaceId: true, name: true, sortOrder: true } });
  }

  async createFolder(userId: string, workspaceId: string, name: string) {
    await this.access.workspace(userId, workspaceId, 'folder.manage');
    const max = await this.prisma.folder.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
    const folder = await this.prisma.folder.create({ data: { workspaceId, name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await this.audit.log({ action: 'folder.created', actorId: userId, workspaceId, targetType: 'folder', targetId: folder.id });
    return { id: folder.id, workspaceId, name: folder.name, sortOrder: folder.sortOrder };
  }

  async updateFolder(userId: string, folderId: string, data: { name?: string; sortOrder?: number }) {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) throw Errors.notFound('Folder');
    await this.access.workspace(userId, folder.workspaceId, 'folder.manage');
    await this.prisma.folder.update({ where: { id: folderId }, data });
    await this.audit.log({ action: 'folder.updated', actorId: userId, workspaceId: folder.workspaceId, targetType: 'folder', targetId: folderId });
    return { ok: true };
  }

  async deleteFolder(userId: string, folderId: string) {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) throw Errors.notFound('Folder');
    await this.access.workspace(userId, folder.workspaceId, 'folder.manage');
    await this.prisma.$transaction([
      this.prisma.project.updateMany({ where: { folderId }, data: { folderId: null } }),
      this.prisma.folder.update({ where: { id: folderId }, data: { deletedAt: new Date() } }),
    ]);
    await this.audit.log({ action: 'folder.deleted', actorId: userId, workspaceId: folder.workspaceId, targetType: 'folder', targetId: folderId });
    return { ok: true };
  }
}
