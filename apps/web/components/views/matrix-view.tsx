'use client';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { cn } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useMemo } from 'react';
import { useFeature, useUpdateTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { TaskRow } from '../task/task-row';
import { useProjectMap } from './common';

type Q = 'do' | 'schedule' | 'delegate' | 'drop';
const QUADRANTS: Array<{ id: Q; title: string; hint: string; color: string }> = [
  { id: 'do', title: 'Do first', hint: 'Urgent · Important', color: '#FF7A93' },
  { id: 'schedule', title: 'Schedule', hint: 'Important · Not urgent', color: '#60E9FF' },
  { id: 'delegate', title: 'Delegate', hint: 'Urgent · Less important', color: '#FFBC5C' },
  { id: 'drop', title: 'Later / drop', hint: 'Neither', color: '#A58CFF' },
];

export function quadrantOf(t: TaskDTO, tz: string): Q {
  const important = t.priority === 'HIGH' || t.priority === 'CRITICAL';
  const urgent = !!t.dueAt && DateTime.fromISO(t.dueAt).setZone(tz) <= DateTime.now().setZone(tz).plus({ days: 2 }).endOf('day');
  return important ? (urgent ? 'do' : 'schedule') : urgent ? 'delegate' : 'drop';
}

function Cell({ q, tasks, advanced }: { q: (typeof QUADRANTS)[number]; tasks: TaskDTO[]; advanced: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: q.id, disabled: !advanced });
  const projects = useProjectMap();
  return (
    <section ref={setNodeRef} aria-label={`${q.title}: ${q.hint}`} className={cn('glass flex min-h-64 flex-col rounded-[22px] p-3 transition-shadow', isOver && 'shadow-[0_0_0_1px_var(--q),0_0_40px_-12px_var(--q)_inset]')} style={{ ['--q' as string]: q.color }}>
      <header className="mb-2 flex items-baseline gap-2 px-1">
        <span className="h-2.5 w-2.5 self-center rounded-full" style={{ background: q.color, boxShadow: `0 0 10px ${q.color}` }} />
        <h2 className="font-display font-semibold">{q.title}</h2>
        <span className="text-xs text-ink-faint">{q.hint}</span>
        <span className="ml-auto text-xs text-ink-faint">{tasks.length}</span>
      </header>
      <ul className="scroll-thin max-h-[42vh] space-y-0.5 overflow-y-auto">
        {tasks.map((t) => (
          <Draggable key={t.id} id={t.id} enabled={advanced}>
            <TaskRow task={t} project={projects.get(t.projectId)} showProject compact />
          </Draggable>
        ))}
      </ul>
    </section>
  );
}

function Draggable({ id, enabled, children }: { id: string; enabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id, disabled: !enabled });
  const { role: _role, tabIndex: _tab, 'aria-pressed': _pressed, 'aria-disabled': _disabled, ...aria } = attributes;
  return (
    <li ref={setNodeRef} {...(enabled ? listeners : {})} {...(enabled ? aria : {})} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined} className={cn(isDragging && 'relative z-20 rounded-2xl bg-surface shadow-[var(--shadow-lift)]')}>
      {children}
    </li>
  );
}

/** Eisenhower Matrix. Basic on Free (view + complete); Premium adds drag-to-reprioritize. */
export function MatrixView({ tasks }: { tasks: TaskDTO[] }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const advanced = useFeature('view.matrixAdvanced');
  const update = useUpdateTask();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const open = tasks.filter((t) => !t.completedAt);
  const grouped = useMemo(() => {
    const m: Record<Q, TaskDTO[]> = { do: [], schedule: [], delegate: [], drop: [] };
    for (const t of open) m[quadrantOf(t, tz)].push(t);
    return m;
  }, [open, tz]);

  function onDragEnd(e: DragEndEvent) {
    const task = open.find((t) => t.id === e.active.id);
    const target = e.over?.id as Q | undefined;
    if (!task || !target || quadrantOf(task, tz) === target) return;
    const important = target === 'do' || target === 'schedule';
    const urgent = target === 'do' || target === 'delegate';
    const patch: Record<string, unknown> = {};
    const wasImportant = task.priority === 'HIGH' || task.priority === 'CRITICAL';
    if (important && !wasImportant) patch.priority = 'HIGH';
    if (!important && wasImportant) patch.priority = 'MEDIUM';
    const due = task.dueAt ? DateTime.fromISO(task.dueAt).setZone(tz) : null;
    const isUrgent = !!due && due <= DateTime.now().setZone(tz).plus({ days: 2 }).endOf('day');
    if (urgent && !isUrgent) patch.dueAt = DateTime.now().setZone(tz).endOf('day').startOf('minute').toUTC().toISO();
    if (!urgent && isUrgent) patch.dueAt = DateTime.now().setZone(tz).plus({ days: 7 }).startOf('day').toUTC().toISO();
    if ('dueAt' in patch && !('priority' in patch) && task.allDay === false) patch.allDay = true;
    update.mutate({ task, patch });
  }

  return (
    <div className="px-4 md:px-8">
      {!advanced && (
        <p className="mb-3 text-xs text-ink-faint">
          <Sparkles size={12} className="mr-1 inline text-amber" />
          Drag tasks between quadrants with <Link href="/app/settings/billing" className="text-amber hover:underline">Premium’s advanced Matrix</Link>.
        </p>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-2">
          {QUADRANTS.map((q) => (
            <Cell key={q.id} q={q} tasks={grouped[q.id]} advanced={advanced} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
