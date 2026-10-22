'use client';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDroppable, useDraggable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { cn } from '@remindora/ui';
import type { ProjectDTO, TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { keys, reportError, useUpdateTask } from '@/lib/queries';
import { TaskRow } from '../task/task-row';
import { InlineAdd } from './list-view';
import { sortByOrder, useMemberMap, usePrefersReducedMotion, useProjectMap } from './common';

interface Column {
  id: string;
  title: string;
  accent: string;
  tasks: TaskDTO[];
  patch: Record<string, unknown>;
}

const STATUS_COLUMNS = [
  { id: 'TODO', title: 'To do', accent: '#60E9FF' },
  { id: 'IN_PROGRESS', title: 'In progress', accent: '#A58CFF' },
  { id: 'BLOCKED', title: 'Blocked', accent: '#FF7A93' },
  { id: 'DONE', title: 'Done', accent: '#7CF3B0' },
];

/** Prefer the column under the pointer; fall back to overlap so drops near edges still "snap". */
const magnetic: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

function Card({ task, project, members }: { task: TaskDTO; project?: ProjectDTO; members: Map<string, { name: string | null; email: string }> }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('glass rounded-2xl transition-opacity', isDragging && 'opacity-30')} aria-roledescription="draggable card">
      <TaskRow task={task} project={project} members={members} />
    </div>
  );
}

function ColumnView({ col, children, active }: { col: Column; children: React.ReactNode; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${col.title} column`}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-[22px] border border-line bg-bg-elevated/40 p-2 transition-[box-shadow,border-color,transform] duration-200',
        active && 'border-dashed',
        isOver && 'scale-[1.01] border-solid',
      )}
      style={isOver ? { borderColor: `${col.accent}99`, boxShadow: `0 0 0 1px ${col.accent}55, 0 0 40px -10px ${col.accent}88 inset` } : undefined}
    >
      <header className="flex items-center gap-2 px-2 pb-2 pt-1">
        <span className="h-2 w-2 rounded-full" style={{ background: col.accent, boxShadow: `0 0 8px ${col.accent}` }} />
        <h2 className="text-sm font-semibold">{col.title}</h2>
        <span className="text-xs text-ink-faint">{col.tasks.length}</span>
      </header>
      <div className="scroll-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
    </section>
  );
}

export function KanbanView({ tasks, project }: { tasks: TaskDTO[]; project?: ProjectDTO }) {
  const projects = useProjectMap();
  const members = useMemberMap(project?.workspaceId);
  const update = useUpdateTask();
  const reduced = usePrefersReducedMotion();
  const qc = useQueryClient();
  const [dragging, setDragging] = useState<TaskDTO | null>(null);
  const [newSection, setNewSection] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const columns: Column[] = useMemo(() => {
    if (project && project.sections.length) {
      const palette = ['#60E9FF', '#A58CFF', '#FFBC5C', '#7CF3B0', '#FF7A93', '#68BFFF'];
      const cols: Column[] = project.sections.map((s, i) => ({ id: s.id, title: s.name, accent: palette[i % palette.length]!, tasks: sortByOrder(tasks.filter((t) => t.sectionId === s.id)), patch: { sectionId: s.id } }));
      const loose = tasks.filter((t) => !t.sectionId || !project.sections.some((s) => s.id === t.sectionId));
      if (loose.length) cols.unshift({ id: 'none', title: 'No section', accent: '#7D92B4', tasks: sortByOrder(loose), patch: { sectionId: null } });
      return cols;
    }
    return STATUS_COLUMNS.map((c) => ({ ...c, tasks: sortByOrder(tasks.filter((t) => (c.id === 'DONE' ? !!t.completedAt : !t.completedAt && t.status === c.id))), patch: { status: c.id } }));
  }, [tasks, project]);

  function onStart(e: DragStartEvent) {
    setDragging(tasks.find((t) => t.id === e.active.id) ?? null);
  }
  function onEnd(e: DragEndEvent) {
    setDragging(null);
    const task = tasks.find((t) => t.id === e.active.id);
    const col = columns.find((c) => c.id === e.over?.id);
    if (!task || !col || col.tasks.some((t) => t.id === task.id)) return;
    const last = col.tasks[col.tasks.length - 1];
    update.mutate({ task, patch: { ...col.patch, sortOrder: (last?.sortOrder ?? 0) + 1 } });
  }

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !newSection.trim()) return;
    try {
      await api(`/projects/${project.id}/sections`, { body: { name: newSection.trim() } });
      setNewSection('');
      qc.invalidateQueries({ queryKey: keys.projects });
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={magnetic} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      <div className="scroll-thin flex gap-3 overflow-x-auto px-4 pb-4 md:px-8">
        {columns.map((col) => (
          <ColumnView key={col.id} col={col} active={!!dragging}>
            {col.tasks.map((t) => (
              <Card key={t.id} task={t} project={projects.get(t.projectId)} members={members} />
            ))}
            {project && <InlineAdd defaults={{ projectId: project.id, ...('sectionId' in col.patch ? { sectionId: col.patch.sectionId } : {}) }} />}
          </ColumnView>
        ))}
        {project && (
          <form onSubmit={addSection} className="flex w-[260px] shrink-0 items-start">
            <label className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-line px-3 py-2.5 text-sm text-ink-faint focus-within:border-cyan/50">
              <Plus size={15} />
              <input aria-label="New section" value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Add section" className="flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none" />
            </label>
          </form>
        )}
      </div>
      <DragOverlay dropAnimation={reduced ? null : { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {dragging && (
          <div
            className="glass-strong w-[284px] rounded-2xl"
            style={{
              transform: reduced ? undefined : 'rotate(-2.5deg) scale(1.04) perspective(800px) rotateX(6deg)',
              boxShadow: 'var(--shadow-lift)',
              cursor: 'grabbing',
            }}
          >
            <TaskRow task={dragging} project={projects.get(dragging.projectId)} members={members} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
