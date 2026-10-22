'use client';
import { Avatar, Badge, Button, Field, Input, Select, Spinner } from '@remindora/ui';
import type { Role } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserPlus, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Section } from '@/components/settings/section';
import { api } from '@/lib/api';
import { relative } from '@/lib/dates';
import { keys, reportError, useMembers, useWorkspaces } from '@/lib/queries';
import { useSession } from '@/lib/session';

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id);
  const { data: workspaces = [] } = useWorkspaces();
  const id = params.get('id') ?? workspaces.find((w) => !w.isPersonal)?.id ?? null;
  const ws = workspaces.find((w) => w.id === id);
  const { data: members = [], refetch } = useMembers(ws && !ws.isPersonal ? ws.id : null);
  const canManage = ws?.role === 'OWNER' || ws?.role === 'ADMIN';
  const { data: invites = [], refetch: refetchInvites } = useQuery({ queryKey: ['invites', id], queryFn: () => api<Array<{ id: string; email: string; role: Role; expiresAt: string }>>(`/workspaces/${id}/invites`), enabled: !!id && canManage && !ws?.isPersonal });
  const { data: audit = [] } = useQuery({ queryKey: ['audit', id], queryFn: () => api<Array<{ id: string; action: string; outcome: string; createdAt: string; actorId: string | null }>>(`/workspaces/${id}/audit`, { query: { limit: 50 } }), enabled: !!id && canManage && !ws?.isPersonal });
  const [newName, setNewName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const names = new Map(members.map((m) => [m.userId, m.name ?? m.email]));

  return (
    <>
      <Section title="Shared workspaces" description="Share lists with your team. Roles: owner, admin, member, viewer.">
        <div className="flex flex-wrap gap-2">
          {workspaces.filter((w) => !w.isPersonal).map((w) => (
            <Button key={w.id} size="sm" variant={w.id === id ? 'primary' : 'secondary'} onClick={() => router.replace(`/app/settings/workspace?id=${w.id}`)}>{w.name} <span className="opacity-70">· {w.memberCount}</span></Button>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { const w = await api<{ id: string }>('/workspaces', { body: { name: newName } }); setNewName(''); await qc.invalidateQueries({ queryKey: keys.workspaces }); router.replace(`/app/settings/workspace?id=${w.id}`); } catch (err) { reportError(err); } }}>
          <Input aria-label="New workspace name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New workspace name" className="h-9 max-w-xs" />
          <Button type="submit" size="sm" disabled={!newName.trim()}><Plus size={14} /> Create</Button>
        </form>
      </Section>

      {ws && !ws.isPersonal && (
        <>
          <Section title={`Members of ${ws.name}`} description={`Your role: ${ws.role.toLowerCase()}`}>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3">
                  <Avatar name={m.name ?? m.email} size={30} />
                  <div className="min-w-0 flex-1"><div className="text-sm">{m.name ?? m.email}{m.userId === me && ' (you)'}</div><div className="text-xs text-ink-faint">{m.email}</div></div>
                  {canManage && m.userId !== me ? (
                    <Select aria-label={`Role for ${m.name ?? m.email}`} value={m.role} onChange={(e) => api(`/workspaces/${ws.id}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } }).then(() => refetch()).catch(reportError)} className="h-8 w-28 text-xs">
                      {(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map((r) => <option key={r} value={r} disabled={ws.role !== 'OWNER' && (r === 'OWNER' || r === 'ADMIN')}>{r.toLowerCase()}</option>)}
                    </Select>
                  ) : (
                    <Badge>{m.role.toLowerCase()}</Badge>
                  )}
                  {(canManage || m.userId === me) && (
                    <Button size="icon-sm" variant="ghost" aria-label={m.userId === me ? 'Leave workspace' : `Remove ${m.name ?? m.email}`} onClick={async () => { if (!confirm(m.userId === me ? 'Leave this workspace?' : 'Remove this member?')) return; await api(`/workspaces/${ws.id}/members/${m.userId}`, { method: 'DELETE' }).catch(reportError); if (m.userId === me) { await qc.invalidateQueries({ queryKey: keys.workspaces }); router.replace('/app/settings/workspace'); } else refetch(); }}>
                      <X size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          {canManage && (
            <Section title="Invite people" description="They’ll get an email link. Pending invites count toward your plan’s member limit.">
              <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api(`/workspaces/${ws.id}/invites`, { body: { email, role } }); setEmail(''); refetchInvites(); toast.success('Invite sent'); } catch (err) { reportError(err); } }}>
                <Field label="Email" htmlFor="inv-email" className="min-w-56 flex-1"><Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Role" htmlFor="inv-role"><Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-32">{(['ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map((r) => <option key={r} value={r} disabled={r === 'ADMIN' && ws.role !== 'OWNER'}>{r.toLowerCase()}</option>)}</Select></Field>
                <Button type="submit" className="self-end" variant="primary"><UserPlus size={15} /> Invite</Button>
              </form>
              {invites.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm">
                  {invites.map((i) => (
                    <li key={i.id} className="flex items-center gap-3"><span className="flex-1">{i.email}</span><Badge>{i.role.toLowerCase()}</Badge><span className="text-xs text-ink-faint">expires {relative(i.expiresAt)}</span><Button size="icon-sm" variant="ghost" aria-label={`Revoke invite for ${i.email}`} onClick={() => api(`/workspaces/${ws.id}/invites/${i.id}`, { method: 'DELETE' }).then(() => refetchInvites()).catch(reportError)}><X size={14} /></Button></li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {canManage && (
            <Section title="Audit log" description="Security-relevant actions in this workspace, including denied attempts.">
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <span className={`flex-1 ${a.outcome === 'denied' ? 'text-danger' : ''}`}>{a.action}</span>
                    <span className="text-xs text-ink-muted">{a.actorId ? (names.get(a.actorId) ?? 'former member') : 'system'}</span>
                    <span className="text-xs text-ink-faint">{relative(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      {!workspaces.some((w) => !w.isPersonal) && <p className="text-sm text-ink-faint">You’re not in any shared workspaces yet.</p>}
      {!ws && workspaces.some((w) => !w.isPersonal) && <Spinner />}
    </>
  );
}

export default function WorkspacePage() {
  return <Suspense><Inner /></Suspense>;
}
