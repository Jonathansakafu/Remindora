'use client';
import { Kbd } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { Command } from 'cmdk';
import { FolderOpen, Moon, Plus, Search, Smartphone, Sun, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useProjects } from '@/lib/queries';
import { useUi } from '@/lib/ui-store';
import { primaryNav, secondaryNav, simpleNav } from './nav';
import * as Dialog from '@radix-ui/react-dialog';

/** ⌘K command palette: navigate, search tasks, run actions. */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const { setQuickAdd, selectTask, theme, setTheme } = useUi();
  const router = useRouter();
  const { data: projects = [] } = useProjects();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TaskDTO[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ tasks: TaskDTO[] }>('/search', { query: { q }, signal: ctrl.signal }).then((r) => setResults(r.tasks)).catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-muted aria-selected:bg-white/[0.07] aria-selected:text-ink';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (setOpen(o), !o && setQ(''))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#030719]/70 backdrop-blur-sm animate-fade" />
        <Dialog.Content className="glass-strong fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[22px] animate-rise">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search tasks, jump to a view, or run a command</Dialog.Description>
          <Command label="Command palette" shouldFilter={true}>
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search size={16} className="text-ink-faint" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search tasks or type a command…" className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-ink-faint focus:outline-none" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-ink-faint">No matches.</Command.Empty>
              {results.length > 0 && (
                <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
                  {results.map((t) => (
                    <Command.Item key={t.id} value={`task ${t.title} ${t.id}`} onSelect={() => (selectTask(t.id), setOpen(false))} className={item}>
                      <span className={t.completedAt ? 'line-through opacity-60' : ''}>{t.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
                <Command.Item onSelect={() => (setOpen(false), setQuickAdd(true))} className={item}>
                  <Plus size={16} /> New task <span className="ml-auto"><Kbd>N</Kbd></span>
                </Command.Item>
                <Command.Item onSelect={() => go('/app/focus')} className={item}>
                  <Target size={16} /> Start a focus session
                </Command.Item>
                <Command.Item onSelect={() => go('/app/settings/link-device')} className={item}>
                  <Smartphone size={16} /> Link a new device
                </Command.Item>
                <Command.Item onSelect={() => (setTheme(theme === 'observatory' ? 'daybreak' : 'observatory'), setOpen(false))} className={item}>
                  {theme === 'observatory' ? <Sun size={16} /> : <Moon size={16} />} Switch to {theme === 'observatory' ? 'Daybreak (light)' : 'Observatory (dark)'} theme
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-faint">
                {[...simpleNav, ...primaryNav, ...secondaryNav].map((n) => (
                  <Command.Item key={n.href} onSelect={() => go(n.href)} className={item}>
                    <n.icon size={16} /> {n.label}
                  </Command.Item>
                ))}
                {projects.filter((p) => !p.isInbox).map((p) => (
                  <Command.Item key={p.id} value={`list ${p.name}`} onSelect={() => go(`/app/project?id=${p.id}`)} className={item}>
                    <FolderOpen size={16} style={{ color: p.color }} /> {p.name}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
