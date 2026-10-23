'use client';
import { Button, GlassPanel, Input } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  Flame,
  Grid2x2,
  Hash,
  Hourglass,
  Inbox,
  Info,
  ListTodo,
  Orbit,
  Plus,
  Settings,
  Smartphone,
  Star,
  Sun,
  Target,
  Trash2,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { keys, reportError, useFilters, useProjects } from '@/lib/queries';

const GROUPS = [
  {
    title: 'Plan your tasks',
    text: 'See what’s due and organise your day',
    icon: CalendarDays,
    tone: 'text-cyan bg-cyan/12',
    items: [
      { href: '/app/today', label: 'Today', text: 'Due today', icon: Sun },
      { href: '/app/inbox', label: 'Inbox', text: 'No date yet', icon: Inbox },
      { href: '/app/upcoming', label: 'Upcoming', text: 'Next 7 days', icon: CalendarRange },
      { href: '/app/calendar', label: 'Calendar', text: 'Day, week, month', icon: CalendarDays },
      { href: '/app/overdue', label: 'Overdue', text: 'Past their date', icon: AlertTriangle },
    ],
  },
  {
    title: 'Focus & habits',
    text: 'Concentrate and build routines',
    icon: Target,
    tone: 'text-success bg-success/12',
    items: [
      { href: '/app/focus', label: 'Focus timer', text: 'Pomodoro sessions', icon: Target },
      { href: '/app/habits', label: 'Habit tracker', text: 'Streaks & history', icon: Flame },
      { href: '/app/countdowns', label: 'Countdowns', text: 'Days until…', icon: Hourglass },
    ],
  },
  {
    title: 'Your progress',
    text: 'What you finished and how you’re doing',
    icon: BarChart3,
    tone: 'text-violet bg-violet/12',
    items: [
      { href: '/app/analytics', label: 'Reports', text: 'Trends & charts', icon: BarChart3 },
      { href: '/app/completed', label: 'Completed', text: 'Finished tasks', icon: CheckCheck },
      { href: '/app/matrix', label: 'Priority matrix', text: 'Urgent vs important', icon: Grid2x2 },
      { href: '/app/orbit', label: 'Orbit view', text: 'Your day in 3D', icon: Orbit },
    ],
  },
  {
    title: 'Organise',
    text: 'Keep things tidy',
    icon: Star,
    tone: 'text-amber bg-amber/12',
    items: [
      { href: '/app/favorites', label: 'Favorites', text: 'Starred tasks', icon: Star },
      { href: '/app/assigned', label: 'Assigned to me', text: 'From others', icon: UserCheck },
      { href: '/app/archive', label: 'Archive', text: 'Put away', icon: Archive },
      { href: '/app/trash', label: 'Trash', text: 'Kept 30 days', icon: Trash2 },
    ],
  },
  {
    title: 'App & account',
    text: 'Settings, devices and help',
    icon: Settings,
    tone: 'text-ink bg-white/8',
    items: [
      { href: '/app/settings', label: 'Settings', text: 'Alarm, notifications', icon: Settings },
      { href: '/app/settings/devices', label: 'My devices', text: 'Signed-in devices', icon: Smartphone },
      { href: '/about', label: 'About', text: 'Who built it', icon: Info },
    ],
  },
];

function CategoryCard({ group }: { group: (typeof GROUPS)[number] }) {
  const id = `more-${group.title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <GlassPanel className="p-4 md:p-5">
      <section aria-labelledby={id}>
        <div className="mb-4 flex items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${group.tone}`}>
            <group.icon size={21} />
          </span>
          <div className="min-w-0">
            <h2 id={id} className="font-display text-lg font-semibold">
              {group.title}
            </h2>
            <p className="text-sm text-ink-muted">{group.text}</p>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {group.items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex h-full min-h-20 flex-col justify-between gap-2 rounded-xl border border-line bg-bg-elevated/60 p-3 transition-colors hover:border-line-strong hover:bg-white/5">
                <i.icon size={19} className="text-ink-muted" />
                <span>
                  <span className="block text-sm font-semibold leading-tight">{i.label}</span>
                  <span className="block truncate text-xs text-ink-faint">{i.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </GlassPanel>
  );
}

export default function MorePage() {
  const { data: projects = [] } = useProjects();
  const { data: filters = [] } = useFilters();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const lists = projects.filter((p) => !p.archived);

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api('/projects', { body: { name: name.trim() } });
      setName('');
      await qc.invalidateQueries({ queryKey: keys.projects });
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="mx-auto px-4 pt-5 md:px-8 md:pt-7 max-w-4xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">More</h1>
      <p className="mt-1 text-ink-muted">Extra tools for when you need them.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <CategoryCard key={g.title} group={g} />
        ))}
      </div>

      <section aria-labelledby="more-lists" className="mt-4">
        <GlassPanel className="p-4 md:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan/12 text-cyan">
              <ListTodo size={21} />
            </span>
            <div>
              <h2 id="more-lists" className="font-display text-lg font-semibold">
                My lists
              </h2>
              <p className="text-sm text-ink-muted">Group tasks by project or place</p>
            </div>
          </div>
          {lists.length > 0 && (
            <ul className="mb-4 grid gap-1 sm:grid-cols-2">
              {lists.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/project?id=${p.id}`} className="flex h-10 items-center gap-2.5 rounded-xl px-2 hover:bg-white/5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="truncate">{p.isInbox ? 'Inbox' : p.name}</span>
                    {p.taskCount > 0 && <span className="ml-auto text-xs tabular-nums text-ink-faint">{p.taskCount}</span>}
                  </Link>
                </li>
              ))}
              {filters.map((f) => (
                <li key={f.id}>
                  <Link href={`/app/filter?id=${f.id}`} className="flex h-10 items-center gap-2.5 rounded-xl px-2 hover:bg-white/5">
                    <Hash size={14} className="text-ink-faint" />
                    <span className="truncate">{f.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createList} className="flex gap-2">
            <label htmlFor="new-list" className="sr-only">
              New list name
            </label>
            <Input id="new-list" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="New list, e.g. Shopping" className="h-11" />
            <Button type="submit" variant="secondary" disabled={!name.trim()}>
              <Plus size={16} /> Add list
            </Button>
          </form>
        </GlassPanel>
      </section>
    </div>
  );
}
