'use client';
import { Avatar, cn, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, RemindoraMark } from '@remindora/ui';
import { ChevronDown, LogOut, Plus, Settings, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useReminderForm } from '@/lib/reminder-form';
import { useSession } from '@/lib/session';
import { settingsNav, simpleNav } from './nav';

function NavLink({ href, label, icon: Icon, active, onNavigate }: { href: string; label: string; icon: React.ElementType; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-ink-muted transition-colors hover:bg-white/5 hover:text-ink',
        active && 'bg-gradient-to-r from-cyan/15 to-transparent text-ink shadow-[inset_3px_0_0_0_var(--color-cyan)]',
      )}
    >
      <Icon size={20} className={cn('shrink-0', active ? 'text-cyan' : 'text-ink-faint group-hover:text-ink-muted')} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Simple navigation: Reminders, Checklist, Stopwatch, More, Settings. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const openForm = useReminderForm((s) => s.open);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-3 pb-5 pt-1">
        <RemindoraMark size={32} />
        <span className="font-display text-lg font-semibold tracking-tight">Remindora</span>
      </div>

      <button
        type="button"
        onClick={() => {
          openForm();
          onNavigate?.();
        }}
        className="mb-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan text-[15px] font-semibold text-on-accent shadow-[0_8px_24px_-8px_rgb(96_233_255/0.6)] hover:brightness-110"
      >
        <Plus size={19} /> New reminder
      </button>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {simpleNav.map((n) => (
          <NavLink key={n.href} {...n} active={isActive(n.href)} onNavigate={onNavigate} />
        ))}
        <div className="pt-2">
          <NavLink {...settingsNav} active={isActive(settingsNav.href)} onNavigate={onNavigate} />
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
    </nav>
  );
}
