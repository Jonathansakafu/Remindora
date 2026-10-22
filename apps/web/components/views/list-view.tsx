'use client';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn, EmptyState } from '@remindora/ui';
import type { ProjectDTO, TaskDTO } from '@remindora/types';
import { ChevronRight, Plus, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { inZone } from '@/lib/dates';
import { useCreateTask, useUpdateTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { TaskRow } from '../task/task-row';
import { orderBetween, sortByOrder, useMemberMap, useProjectMap } from './common';

export type Grouping = 'due' | 'sections' | 'project' | 'none';

interface Group {
  key: string;
  title: string;
  tone?: string;
  tasks: TaskDTO[];
  sectionId?: string | null;
}

function groupTasks(tasks: TaskDTO[], grouping: Grouping, tz: string, project?: ProjectDTO, projects?: Map<string, ProjectDTO>): Group[] {
  if (grouping === 'none') return [{ key: 'all', title: '', tasks }];
  if (grouping === 'sections' && project) {
    const groups: Group[] = [{ key: 'none', title: project.sections.length ? 'No section' : '', tasks: sortByOrder(tasks.filter((t) => !t.sectionId)), sectionId: null }];
    for (const s of project.sections) groups.push({ key: s.id, title: s.name, tasks: sortByOrder(tasks.filter((t) => t.sectionId === s.id)), sectionId: s.id });
    return groups.filter((g) => g.tasks.length || g.key !== 'none' || !project.sections.length);
  }
  if (grouping === 'project') {
    const by = new Map<string, TaskDTO[]>();
    for (const t of tasks) by.set(t.projectId, [...(by.get(t.projectId) ?? []), t]);
    return [...by.entries()].map(([id, list]) => ({ key: id, title: projects?.get(id)?.isInbox ? 'Inbox' : (projects?.get(id)?.name ?? 'List'), tasks: list }));
  }
  const now = DateTime.now().setZone(tz);
  const today = now.startOf('day');
  const buckets: Record<string, Group> = {
    overdue: { key: 'overdue', title: 'Overdue', tone: 'text-danger', tasks: [] },
    today: { key: 'today', title: 'Today', tone: 'text-cyan', tasks: [] },
    tomorrow: { key: 'tomorrow', title: 'Tomorrow', tasks: [] },
    week: { key: 'week', title: 'Next 7 days', tasks: [] },
    later: { key: 'later', title: 'Later', tasks: [] },
    none: { key: 'none', title: 'No date', tasks: [] },
  };
  for (const t of tasks) {
    if (!t.dueAt) {
      buckets.none!.tasks.push(t);
      continue;
    }
    const d = inZone(t.dueAt, tz);
    const days = Math.round(d.startOf('day').diff(today, 'days').days);
    const overdue = !t.completedAt && (t.allDay ? days < 0 : d < now);
    if (overdue) buckets.overdue!.tasks.push(t);
    else if (days <= 0) buckets.today!.tasks.push(t);
    else if (days === 1) buckets.tomorrow!.tasks.push(t);
    else if (days <= 7) buckets.week!.tasks.push(t);
    else buckets.later!.tasks.push(t);
  }
  return Object.values(buckets).filter((g) => g.tasks.length);
}

function SortableRow({ task, children }: { task: TaskDTO; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 scale-[1.01] rounded-2xl shadow-[var(--shadow-lift)]')}
      {...attributes}
      {...listeners}
      aria-roledescription="sortable task"
    >
      {children}
    </li>
  );
}

export function ListView({
  tasks,
  grouping = 'due',
  project,
  showProject = true,
  emptyTitle,
  emptyBody,
  addDefaults,
  sortable,
  readOnly,
}: {
  tasks: TaskDTO[];
  grouping?: Grouping;
  project?: ProjectDTO;
  showProject?: boolean;
  emptyTitle: string;
  emptyBody?: string;
  addDefaults?: Record<string, unknown> | null;
  sortable?: boolean;
  readOnly?: boolean;
}) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const projects = useProjectMap();
  const members = useMemberMap(project?.workspaceId);
  const groups = useMemo(() => groupTasks(tasks, grouping, tz, project, projects), [tasks, grouping, tz, project, projects]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const update = useUpdateTask();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const all = groups.flatMap((g) => g.tasks.map((t) => ({ t, g })));
    const from = all.find((x) => x.t.id === e.active.id);
    const to = all.find((x) => x.t.id === e.over!.id);
    if (!from || !to) return;
    const list = to.g.tasks.filter((t) => t.id !== from.t.id);
    const idx = list.findIndex((t) => t.id === to.t.id);
    const movingDown = all.indexOf(from) < all.indexOf(to);
    const before = movingDown ? list[idx] : list[idx - 1];
    const after = movingDown ? list[idx + 1] : list[idx];
    const patch: Record<string, unknown> = { sortOrder: orderBetween(before?.sortOrder, after?.sortOrder) };
    if (grouping === 'sections' && from.g.sectionId !== to.g.sectionId) patch.sectionId = to.g.sectionId ?? null;
    update.mutate({ task: from.t, patch });
  }

  const body = (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={g.title ? `grp-${g.key}` : undefined}>
          {g.title && (
            <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))} className="mb-1 flex items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint hover:text-ink-muted" aria-expanded={!collapsed[g.key]}>
              <ChevronRight size={13} className={cn('transition-transform', !collapsed[g.key] && 'rotate-90')} />
              <span id={`grp-${g.key}`} className={g.tone}>{g.title}</span>
              <span className="font-normal">{g.tasks.length}</span>
            </button>
          )}
          {!collapsed[g.key] && (
            <SortableContext items={g.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-0.5">
                {g.tasks.map((t) =>
                  sortable && !readOnly ? (
                    <SortableRow key={t.id} task={t}>
                      <TaskRow task={t} project={projects.get(t.projectId)} showProject={showProject} members={members} readOnly={readOnly} />
                    </SortableRow>
                  ) : (
                    <li key={t.id}>
                      <TaskRow task={t} project={projects.get(t.projectId)} showProject={showProject} members={members} readOnly={readOnly} />
                    </li>
                  ),
                )}
              </ul>
            </SortableContext>
          )}
          {grouping === 'sections' && addDefaults !== null && !readOnly && g.sectionId !== undefined && <InlineAdd defaults={{ ...addDefaults, sectionId: g.sectionId }} />}
        </section>
      ))}
      {addDefaults !== null && !readOnly && grouping !== 'sections' && <InlineAdd defaults={addDefaults ?? {}} />}
    </div>
  );

  if (!tasks.length) {
    return (
      <>
        <EmptyState icon={<Sparkles size={22} />} title={emptyTitle} body={emptyBody} />
        {addDefaults !== null && !readOnly && <div className="mx-auto max-w-xl"><InlineAdd defaults={addDefaults ?? {}} /></div>}
      </>
    );
  }
  return sortable && !readOnly ? (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {body}
    </DndContext>
  ) : (
    body
  );
}

export function InlineAdd({ defaults }: { defaults: Record<string, unknown> }) {
  const [title, setTitle] = useState('');
  const create = useCreateTask();
  return (
    <form
      className="mt-1 flex items-center gap-3 rounded-2xl px-3 py-1.5 text-sm hover:bg-white/[0.02] focus-within:bg-white/[0.03]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate({ title: title.trim(), checklist: [], dependsOn: [], tags: [], ...defaults });
        setTitle('');
      }}
    >
      <Plus size={16} className="text-cyan" />
      <input aria-label="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" className="h-8 flex-1 bg-transparent placeholder:text-ink-faint focus:outline-none" />
    </form>
  );
}
