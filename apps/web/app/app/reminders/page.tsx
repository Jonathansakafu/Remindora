'use client';
import { Button, cn, GlassPanel, Spinner } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { alarmSoundLabel } from '@remindora/core';
import { AlarmClock, Bell, Check, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { useCompleteTask, useDeleteTask, useTasks } from '@/lib/queries';
import { repeatLabel, useReminderForm } from '@/lib/reminder-form';
import { useSession } from '@/lib/session';

function groupLabel(d: DateTime, now: DateTime) {
  if (d < now) return 'Missed';
  if (d.hasSame(now, 'day')) return 'Today';
  if (d.hasSame(now.plus({ days: 1 }), 'day')) return 'Tomorrow';
  return d.toFormat('cccc d LLLL');
}

function ReminderRow({ task, tz, missed }: { task: TaskDTO; tz: string; missed: boolean }) {
  const open = useReminderForm((s) => s.open);
  const complete = useCompleteTask();
  const remove = useDeleteTask();
  const due = DateTime.fromISO(task.dueAt!).setZone(tz);
  const repeat = repeatLabel(task.recurrence?.rrule);
  return (
    <li>
      <GlassPanel className={cn('flex items-center gap-4 p-4', missed && 'border-danger/40')}>
        <div className="w-20 shrink-0 text-center">
          <div className={cn('font-display text-2xl font-semibold tabular-nums', missed ? 'text-danger' : 'text-ink')}>{due.toFormat('HH:mm')}</div>
          <div className="text-xs text-ink-faint">{due.toFormat('ccc d LLL')}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
            {missed && <span className="font-medium text-danger">Missed</span>}
            {repeat && (
              <span className="inline-flex items-center gap-1">
                <Repeat size={13} /> {repeat}
              </span>
            )}
            {task.alarmSound && task.alarmSound !== 'alarm' && (
              <span className="inline-flex items-center gap-1">
                <Bell size={13} /> {alarmSoundLabel(task.alarmSound)}
              </span>
            )}
            {task.description && <span className="truncate">{task.description}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={`Mark “${task.title}” as done`} title="Done" onClick={() => complete.mutate({ task, done: true })}>
            <Check size={19} />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Edit “${task.title}”`} title="Edit" onClick={() => open(task)}>
            <Pencil size={17} />
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Delete “${task.title}”`} title="Delete" onClick={() => remove.mutate(task)}>
            <Trash2 size={17} />
          </Button>
        </div>
      </GlassPanel>
    </li>
  );
}

/** The simple home: every reminder (alarm) in time order, with one big button to add another. */
export default function RemindersPage() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const open = useReminderForm((s) => s.open);
  const { data: tasks = [], isLoading } = useTasks({ view: 'reminders' });

  const groups = useMemo(() => {
    const now = DateTime.now().setZone(tz);
    const out = new Map<string, { missed: boolean; items: TaskDTO[] }>();
    for (const t of tasks.filter((t) => t.dueAt && !t.completedAt)) {
      const d = DateTime.fromISO(t.dueAt!).setZone(tz);
      const label = groupLabel(d, now);
      const g = out.get(label) ?? { missed: label === 'Missed', items: [] };
      g.items.push(t);
      out.set(label, g);
    }
    return [...out.entries()];
  }, [tasks, tz]);

  return (
    <div className="mx-auto px-4 pb-24 pt-5 md:px-8 md:pt-7 max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Reminders</h1>
          <p className="mt-1 text-ink-muted">Each one rings like an alarm at the time you set.</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => open()}>
          <Plus size={19} /> New reminder
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <GlassPanel className="flex flex-col items-center p-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-cyan/12 text-cyan">
            <AlarmClock size={30} />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">No reminders yet</h2>
          <p className="mt-1 max-w-sm text-ink-muted">Tell Remindora what to remind you about and when. Your phone and computer will ring at that time.</p>
          <Button variant="primary" size="lg" className="mt-6" onClick={() => open()}>
            <Plus size={19} /> Set your first reminder
          </Button>
        </GlassPanel>
      ) : (
        <div className="space-y-6">
          {groups.map(([label, g]) => (
            <section key={label} aria-labelledby={`grp-${label}`}>
              <h2 id={`grp-${label}`} className={cn('mb-2 text-sm font-semibold uppercase tracking-wider', g.missed ? 'text-danger' : 'text-ink-faint')}>
                {label}
              </h2>
              <ul className="space-y-2">
                {g.items.map((t) => (
                  <ReminderRow key={t.id} task={t} tz={tz} missed={g.missed} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
