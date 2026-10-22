'use client';
import { Button, cn, Kbd, RemindoraMark, Sheet, Spinner, Tooltip } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Menu as MenuIcon, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { keys, useNotifications } from '@/lib/queries';
import { initDesktop } from '@/lib/desktop';
import { connectRealtime, disconnectRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';
import { QuickAdd } from '../task/quick-add';
import { TaskDetail } from '../task/task-detail';
import { ApprovalBanner } from './approval-banner';
import { BulkBar } from './bulk-bar';
import { CommandPalette } from './command-palette';
import { mobileTabs } from './nav';
import { NotificationCenter } from './notification-center';
import { Sidebar } from './sidebar';
import { SyncStatus } from './sync-status';

function useShortcuts() {
  const ui = useUi();
  const router = useRouter();
  useEffect(() => {
    const seq: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPalette(!useUi.getState().paletteOpen);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'q') {
        e.preventDefault();
        ui.setQuickAdd(true);
      } else if (e.key === '/') {
        e.preventDefault();
        ui.setPalette(true);
      } else if (e.key === 'Escape') {
        ui.selectTask(null);
        ui.clearSelection();
      } else {
        // "g t" style navigation.
        seq.push(e.key);
        if (seq.length > 2) seq.shift();
        if (seq[0] === 'g') {
          const map: Record<string, string> = { t: '/app/today', i: '/app/inbox', u: '/app/upcoming', c: '/app/calendar', f: '/app/focus', h: '/app/habits', a: '/app/analytics', m: '/app/matrix' };
          const dest = seq[1] && map[seq[1]];
          if (dest) {
            router.push(dest);
            seq.length = 0;
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, router]);
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return desktop;
}

export function AppShell({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const accessToken = useSession((s) => s.accessToken);
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const ui = useUi();
  const { data: notifications } = useNotifications();
  const isDesktop = useIsDesktop();
  useShortcuts();

  useEffect(() => {
    if (status === 'signed_out') router.replace('/login');
  }, [status, router]);

  // One realtime connection per signed-in session.
  const sessionId = useSession((s) => s.sessionId);
  useEffect(() => {
    if (status !== 'signed_in' || !accessToken) return;
    connectRealtime(qc, { onOpenTask: (id) => useUi.getState().selectTask(id) });
    return () => disconnectRealtime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionId]);

  useEffect(() => {
    if (status === 'signed_in') qc.invalidateQueries({ queryKey: keys.me });
  }, [status, qc]);

  useEffect(() => ui.setMobileNav(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void initDesktop((href) => router.push(href)).then((d) => (dispose = d));
    return () => dispose?.();
  }, [router]);

  if (status !== 'signed_in') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4">
          <RemindoraMark size={56} />
          <Spinner />
        </div>
      </div>
    );
  }

  const unread = notifications?.unread ?? 0;
  const panelOpen = !!ui.selectedTaskId;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-bg-elevated/40 p-3 backdrop-blur-xl md:flex">
        <Suspense>
          <Sidebar />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-5">
          <button type="button" className="rounded-lg p-2 text-ink-muted hover:bg-white/5 md:hidden" onClick={() => ui.setMobileNav(true)} aria-label="Open navigation">
            <MenuIcon size={19} />
          </button>
          <button
            type="button"
            onClick={() => ui.setPalette(true)}
            className="glass flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-sm text-ink-faint hover:border-line-strong md:max-w-md"
            aria-label="Search and commands"
          >
            <Search size={15} /> <span className="truncate">Search or jump to…</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <SyncStatus />
            <Tooltip label="Notifications">
              <button type="button" onClick={() => ui.setNotifications(true)} className="relative rounded-xl p-2 text-ink-muted hover:bg-white/5 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell size={18} />
                {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-[#2a0610]">{unread > 99 ? '99+' : unread}</span>}
              </button>
            </Tooltip>
            <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => ui.setQuickAdd(true)}>
              <Plus size={15} /> Add task <Kbd>N</Kbd>
            </Button>
          </div>
        </header>

        <ApprovalBanner />

        <div className="flex min-h-0 flex-1">
          <main id="main" tabIndex={-1} className="scroll-thin min-w-0 flex-1 overflow-y-auto pb-28 focus:outline-none md:pb-8">
            {children}
          </main>
          {panelOpen && isDesktop && (
            <aside aria-label="Task details" className="w-[420px] shrink-0 border-l border-line bg-bg-elevated/50 backdrop-blur-xl animate-[rise_0.22s_ease-out]">
              <TaskDetail taskId={ui.selectedTaskId!} onClose={() => ui.selectTask(null)} />
            </aside>
          )}
        </div>
      </div>

      {/* Mobile / tablet: details as a slide-over panel. */}
      {!isDesktop && (
        <Sheet open={panelOpen} onOpenChange={(o) => !o && ui.selectTask(null)} title="Task details" side="right">
          {ui.selectedTaskId && <TaskDetail taskId={ui.selectedTaskId} onClose={() => ui.selectTask(null)} />}
        </Sheet>
      )}
      <Sheet open={ui.mobileNavOpen} onOpenChange={ui.setMobileNav} title="Navigation" side="left">
        <div className="h-full p-3">
          <Suspense>
            <Sidebar onNavigate={() => ui.setMobileNav(false)} />
          </Suspense>
        </div>
      </Sheet>

      <nav aria-label="Primary" className="glass-strong fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-2xl px-1 py-1.5 pb-[max(6px,env(safe-area-inset-bottom))] md:hidden">
        {mobileTabs.slice(0, 2).map((t) => (
          <MobileTab key={t.href} {...t} active={pathname.startsWith(t.href)} />
        ))}
        <button type="button" onClick={() => ui.setQuickAdd(true)} className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan text-[#06122e] shadow-[0_8px_24px_-6px_rgb(96_233_255/0.7)]" aria-label="Add task">
          <Plus size={22} />
        </button>
        {mobileTabs.slice(2).map((t) => (
          <MobileTab key={t.href} {...t} active={pathname.startsWith(t.href)} />
        ))}
      </nav>

      <Suspense>
        <QuickAdd />
      </Suspense>
      <CommandPalette />
      <NotificationCenter />
      <BulkBar />
    </div>
  );
}

function MobileTab({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn('flex w-16 flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-medium', active ? 'text-cyan' : 'text-ink-faint')}>
      <Icon size={20} />
      {label}
    </Link>
  );
}
