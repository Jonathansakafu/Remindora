import type { Role } from '@remindora/types';

/** Workspace role-based access control. Every workspace endpoint asserts one of these permissions. */

export const PERMISSIONS = [
  'workspace.read',
  'workspace.update',
  'workspace.delete',
  'workspace.billing',
  'workspace.audit',
  'member.invite',
  'member.remove',
  'member.role',
  'folder.manage',
  'project.read',
  'project.create',
  'project.update',
  'project.delete',
  'task.read',
  'task.create',
  'task.update',
  'task.delete',
  'task.assign',
  'comment.create',
  'comment.moderate',
  'attachment.create',
  'attachment.delete',
  'integration.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = ['workspace.read', 'project.read', 'task.read'];
const CONTRIBUTE: Permission[] = [
  ...READ,
  'project.create',
  'project.update',
  'task.create',
  'task.update',
  'task.delete',
  'task.assign',
  'comment.create',
  'attachment.create',
];
const ADMINISTER: Permission[] = [
  ...CONTRIBUTE,
  'workspace.update',
  'workspace.audit',
  'member.invite',
  'member.remove',
  'member.role',
  'folder.manage',
  'project.delete',
  'comment.moderate',
  'attachment.delete',
  'integration.manage',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>(PERMISSIONS),
  ADMIN: new Set<Permission>(ADMINISTER),
  MEMBER: new Set<Permission>(CONTRIBUTE),
  VIEWER: new Set<Permission>(READ),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].has(permission);
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/**
 * Role change rules:
 * - Owners may change anyone, but a workspace must always keep at least one owner.
 * - Admins may manage members and viewers only, and may not grant admin or owner.
 * - Nobody else may change roles.
 */
export function canChangeRole(input: { actor: Role; target: Role; next: Role; isSelf: boolean; ownerCount: number }): { ok: true } | { ok: false; reason: string } {
  const { actor, target, next, isSelf, ownerCount } = input;
  if (actor === 'OWNER') {
    if (target === 'OWNER' && next !== 'OWNER' && ownerCount <= 1) return { ok: false, reason: 'A workspace needs at least one owner' };
    return { ok: true };
  }
  if (actor === 'ADMIN') {
    if (isSelf) return { ok: false, reason: 'Admins cannot change their own role' };
    if (RANK[target] >= RANK.ADMIN) return { ok: false, reason: 'Admins cannot change owners or other admins' };
    if (RANK[next] >= RANK.ADMIN) return { ok: false, reason: 'Admins cannot grant admin or owner' };
    return { ok: true };
  }
  return { ok: false, reason: 'Insufficient role' };
}

export function canRemoveMember(input: { actor: Role; target: Role; isSelf: boolean; ownerCount: number }): { ok: true } | { ok: false; reason: string } {
  const { actor, target, isSelf, ownerCount } = input;
  if (isSelf) {
    if (target === 'OWNER' && ownerCount <= 1) return { ok: false, reason: 'Transfer ownership before leaving' };
    return { ok: true };
  }
  if (actor === 'OWNER') return { ok: true };
  if (actor === 'ADMIN' && RANK[target] < RANK.ADMIN) return { ok: true };
  return { ok: false, reason: 'Insufficient role' };
}
