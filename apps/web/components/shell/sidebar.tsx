'use client';
import { Avatar, Button, cn, Dialog, DialogContent, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, RemindoraMark, Select } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Folder, Hash, LogOut, Plus, Settings, Smartphone, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { keys, reportError, useEntitlements, useFilters, useProjects, useWorkspaces } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';
import { primaryNav, secondaryNav } from './nav';

function NavLink({ href, label, icon: Icon, count, active, onNavigate }: { href: string; label: string; icon: React.ElementType; count?: number; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm text-ink-muted transition-colors hover:bg-white/5 hover:text-ink',
        active && 'bg-gradient-to-r from-cyan/15 to-transparent text-ink shadow-[inset_2px_0_0_0_var(--color-cyan)]',
      )}
    >
      <Icon size={17} className={cn('shrink-0', active ? 'text-cyan' : 'text-ink-faint group-hover:text-ink-muted')} />
      <span className="truncate">{label}</span>
      {count ? <span className="ml-auto text-xs tabular-nums text-ink-faint">{count}</span> : null}
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const { data: projects = [] } = useProjects();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: filters = [] } = useFilters();
  const { data: ent } = useEntitlements();
  const [newList, setNewList] = useState(false);
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const inbox = projects.find((p) => p.isInbox);

  const grouped = useMemo(() => {
    const byWs = new Map<string, typeof projects>();
    for (const p of projects.filter((p) => !p.isInbox && !p.archived)) byWs.set(p.workspaceId, [...(byWs.get(p.workspaceId) ?? []), p]);
    return workspaces.map((w) => ({ ws: w, projects: byWs.get(w.id) ?? [] })).filter((g) => g.projects.length || !g.ws.isPersonal || true);
  }, [projects, workspaces]);

  const isActive = (href: string) => pathname === href || pathname === `${href}/`;
  const activeProject = pathname.startsWith('/app/project') ? search.get('id') : null;

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    try {
      const p = await api<{ id: string }>('/projects', { body: { name, workspaceId: workspaceId || undefined } });
      await qc.invalidateQueries({ queryKey: keys.projects });
      setNewList(false);
      setName('');
      router.push(`/app/project?id=${p.id}`);
      onNavigate?.();
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-3 pb-4 pt-1">
        <RemindoraMark size={30} />
        <span className="font-display text-[17px] font-semibold tracking-tight">Remindora</span>
        {ent?.plan && ent.plan !== 'FREE' && <span className="ml-auto rounded-md border border-amber/30 bg-amber/10 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber">{ent.plan}</span>}
      </div>

      <div className="scroll-thin -mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        <div className="space-y-0.5">
          {primaryNav.map((n) => (
            <NavLink key={n.href} {...n} count={n.slug === 'inbox' ? inbox?.taskCount : undefined} active={isActive(n.href)} onNavigate={onNavigate} />
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between px-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Projects</h2>
            <button type="button" onClick={() => setNewList(true)} className="rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="New list">
              <Plus size={15} />
            </button>
          </div>
          {grouped.map(({ ws, projects: list }) => (
            <div key={ws.id} className="mb-2">
              {workspaces.length > 1 && (
                <Link href={`/app/settings/workspace?id=${ws.id}`} onClick={onNavigate} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-ink-faint hover:text-ink-muted">
                  {ws.isPersonal ? <Folder size={12} /> : <Users size={12} />} {ws.isPersonal ? 'Personal' : ws.name}
                </Link>
              )}
              <div className="space-y-0.5">
                {list.map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/project?id=${p.id}`}
                    onClick={onNavigate}
                    aria-current={activeProject === p.id ? 'page' : undefined}
                    className={cn('flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm text-ink-muted hover:bg-white/5 hover:text-ink', activeProject === p.id && 'bg-white/[0.06] text-ink')}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}88` }} />
                    <span className="truncate">{p.name}</span>
                    {p.taskCount > 0 && <span className="ml-auto text-xs tabular-nums text-ink-faint">{p.taskCount}</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {(
          <div>
            <div className="mb-1 flex items-center justify-between px-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Filters</h2>
              <Link href="/app/filter?new=1" onClick={onNavigate} className="rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="New filter">
                <Plus size={15} />
              </Link>
            </div>
            {filters.map((f) => (
              <NavLink key={f.id} href={`/app/filter?id=${f.id}`} label={f.name} icon={Hash} active={pathname.startsWith('/app/filter') && search.get('id') === f.id} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        <div>
          <h2 className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">More</h2>
          <div className="space-y-0.5">
            {secondaryNav.map((n) => (
              <NavLink key={n.href} {...n} active={isActive(n.href)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <Menu>
          <MenuTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-white/5">
            <Avatar name={user?.name ?? user?.email} src={user?.avatarUrl} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{user?.name ?? 'Your account'}</span>
              <span className="block truncate text-xs text-ink-faint">{user?.email}</span>
            </span>
            <ChevronDown size={14} className="text-ink-faint" />
          </MenuTrigger>
          <MenuContent align="start" side="top" className="w-60">
            <MenuLabel>Account</MenuLabel>
            <MenuItem onSelect={() => router.push('/app/settings')}><Settings size={15} /> Settings</MenuItem>
            <MenuItem onSelect={() => router.push('/app/settings/devices')}><Smartphone size={15} /> Linked devices</MenuItem>
            <MenuItem onSelect={() => router.push('/app/settings/billing')}><Sparkles size={15} /> Plans & billing</MenuItem>
            <MenuSeparator />
            <MenuItem
              danger
              onSelect={async () => {
                await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
                await useSession.getState().clear();
                router.replace('/login');
              }}
            >
              <LogOut size={15} /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <Dialog open={newList} onOpenChange={setNewList}>
        <DialogContent title="New list" description={ent ? `Your plan allows ${ent.limits['lists.max']} lists.` : undefined}>
          <form onSubmit={createList} className="space-y-4">
            <Field label="Name" htmlFor="list-name">
              <Input id="list-name" autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch plan" />
            </Field>
            {workspaces.length > 1 && (
              <Field label="Workspace" htmlFor="list-ws">
                <Select id="list-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.isPersonal ? '' : w.id}>
                      {w.isPersonal ? 'Personal' : w.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNewList(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>Create list</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
