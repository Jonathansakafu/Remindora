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
    items: [
      { href: '/app/today', label: 'Today', text: 'Everything due today', icon: Sun },
      { href: '/app/inbox', label: 'Inbox', text: 'Quick notes and tasks without a date', icon: Inbox },
      { href: '/app/upcoming', label: 'Upcoming', text: 'The next 7 days', icon: CalendarRange },
      { href: '/app/calendar', label: 'Calendar', text: 'Day, week and month views', icon: CalendarDays },
      { href: '/app/overdue', label: 'Overdue', text: 'Tasks past their date', icon: AlertTriangle },
    ],
  },
  {
    title: 'Focus & habits',
    items: [
      { href: '/app/focus', label: 'Focus timer', text: 'Pomodoro sessions linked to tasks', icon: Target },
      { href: '/app/habits', label: 'Habit tracker', text: 'Streaks and history for your checklist', icon: Flame },
      { href: '/app/countdowns', label: 'Countdowns', text: 'Days until birthdays, trips, exams', icon: Hourglass },
    ],
  },
  {
    title: 'See your progress',
    items: [
      { href: '/app/analytics', label: 'Reports', text: 'What you completed and when', icon: BarChart3 },
      { href: '/app/completed', label: 'Completed', text: 'Everything you’ve finished', icon: CheckCheck },
      { href: '/app/matrix', label: 'Priority matrix', text: 'Urgent vs important', icon: Grid2x2 },
      { href: '/app/orbit', label: 'Orbit view', text: 'A visual overview of your day', icon: Orbit },
    ],
  },
  {
    title: 'Organise',
    items: [
      { href: '/app/favorites', label: 'Favorites', text: 'Starred tasks', icon: Star },
      { href: '/app/assigned', label: 'Assigned to me', text: 'Tasks others gave you', icon: UserCheck },
      { href: '/app/archive', label: 'Archive', text: 'Put away, not deleted', icon: Archive },
      { href: '/app/trash', label: 'Trash', text: 'Deleted items (kept 30 days)', icon: Trash2 },
    ],
  },
  {
    title: 'App',
    items: [
      { href: '/app/settings', label: 'Settings', text: 'Profile, notifications, alarm sound', icon: Settings },
      { href: '/app/settings/devices', label: 'My devices', text: 'Phones and computers signed in', icon: Smartphone },
      { href: '/about', label: 'About Remindora', text: 'Who built it and how to get in touch', icon: Info },
    ],
  },
];

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
    <div className="mx-auto px-4 pb-24 pt-5 md:px-8 md:pt-7 max-w-4xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">More</h1>
      <p className="mt-1 text-ink-muted">Extra tools for when you need them.</p>

      {GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`more-${g.title}`} className="mt-8">
          <h2 id={`more-${g.title}`} className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
            {g.title}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="glass flex items-center gap-3 rounded-2xl p-4 transition-colors hover:border-line-strong">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan/12 text-cyan">
                    <i.icon size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{i.label}</span>
                    <span className="block truncate text-sm text-ink-muted">{i.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="more-lists" className="mt-8">
        <h2 id="more-lists" className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          My lists
        </h2>
        <GlassPanel className="p-4">
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
