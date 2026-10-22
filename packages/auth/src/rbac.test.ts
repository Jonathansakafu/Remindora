import { describe, expect, it } from 'vitest';
import { can, canChangeRole, canRemoveMember, PERMISSIONS } from './rbac';

describe('RBAC', () => {
  it('owners can do everything', () => {
    for (const p of PERMISSIONS) expect(can('OWNER', p)).toBe(true);
  });

  it('viewers are read-only', () => {
    expect(can('VIEWER', 'task.read')).toBe(true);
    expect(can('VIEWER', 'task.create')).toBe(false);
    expect(can('VIEWER', 'comment.create')).toBe(false);
  });

  it('members contribute but cannot administer', () => {
    expect(can('MEMBER', 'task.update')).toBe(true);
    expect(can('MEMBER', 'member.invite')).toBe(false);
    expect(can('MEMBER', 'project.delete')).toBe(false);
  });

  it('admins administer but cannot delete the workspace or handle billing', () => {
    expect(can('ADMIN', 'member.invite')).toBe(true);
    expect(can('ADMIN', 'workspace.delete')).toBe(false);
    expect(can('ADMIN', 'workspace.billing')).toBe(false);
  });

  it('non-members have no permissions', () => {
    expect(can(null, 'task.read')).toBe(false);
  });

  it('role change rules', () => {
    expect(canChangeRole({ actor: 'OWNER', target: 'OWNER', next: 'ADMIN', isSelf: true, ownerCount: 1 }).ok).toBe(false);
    expect(canChangeRole({ actor: 'OWNER', target: 'OWNER', next: 'ADMIN', isSelf: true, ownerCount: 2 }).ok).toBe(true);
    expect(canChangeRole({ actor: 'ADMIN', target: 'MEMBER', next: 'VIEWER', isSelf: false, ownerCount: 1 }).ok).toBe(true);
    expect(canChangeRole({ actor: 'ADMIN', target: 'MEMBER', next: 'ADMIN', isSelf: false, ownerCount: 1 }).ok).toBe(false);
    expect(canChangeRole({ actor: 'ADMIN', target: 'ADMIN', next: 'MEMBER', isSelf: false, ownerCount: 1 }).ok).toBe(false);
    expect(canChangeRole({ actor: 'MEMBER', target: 'VIEWER', next: 'MEMBER', isSelf: false, ownerCount: 1 }).ok).toBe(false);
  });

  it('member removal rules', () => {
    expect(canRemoveMember({ actor: 'OWNER', target: 'OWNER', isSelf: true, ownerCount: 1 }).ok).toBe(false);
    expect(canRemoveMember({ actor: 'VIEWER', target: 'VIEWER', isSelf: true, ownerCount: 1 }).ok).toBe(true);
    expect(canRemoveMember({ actor: 'ADMIN', target: 'ADMIN', isSelf: false, ownerCount: 1 }).ok).toBe(false);
    expect(canRemoveMember({ actor: 'MEMBER', target: 'VIEWER', isSelf: false, ownerCount: 1 }).ok).toBe(false);
  });
});
