'use client';
import { Segmented, usePrefersReducedMotion } from '@remindora/ui';
import type { ProjectDTO, TaskDTO } from '@remindora/types';
import { CalendarDays, Columns3, GanttChart, Grid2x2, List, ListOrdered, Lock } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useFeature, useMembers, useProjects } from '@/lib/queries';
import { useUi, type ListViewKind } from '@/lib/ui-store';

export function PageHeader({ title, subtitle, color, children, actions }: { title: string; subtitle?: ReactNode; color?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 pb-3 pt-5 md:px-8 md:pt-7">
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2.5 font-display text-[26px] font-semibold tracking-tight md:text-[30px]">
          {color && <span className="h-3 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 14px ${color}` }} />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {children}
      {actions}
    </div>
  );
}

const VIEW_META: Record<ListViewKind, { label: string; icon: React.ElementType; feature?: string }> = {
  LIST: { label: 'List', icon: List },
  KANBAN: { label: 'Kanban', icon: Columns3, feature: 'view.kanban' },
  CALENDAR: { label: 'Calendar', icon: CalendarDays },
  TIMELINE: { label: 'Timeline', icon: GanttChart, feature: 'view.timeline' },
  AGENDA: { label: 'Agenda', icon: ListOrdered },
  MATRIX: { label: 'Matrix', icon: Grid2x2, feature: 'view.matrix' },
};

export function ViewSwitcher({ listKey, views, fallback = 'LIST' }: { listKey: string; views: ListViewKind[]; fallback?: ListViewKind }) {
  const current = useUi((s) => s.viewByList[listKey]) ?? fallback;
  const setView = useUi((s) => s.setView);
  const timeline = useFeature('view.timeline');
  return (
    <Segmented
      label="View"
      value={views.includes(current) ? current : fallback}
      onChange={(v) => setView(listKey, v)}
      options={views.map((v) => {
        const m = VIEW_META[v];
        const locked = v === 'TIMELINE' && !timeline;
        return {
          value: v,
          title: locked ? 'Timeline is a Premium view' : m.label,
          label: (
            <>
              <m.icon size={14} />
              <span className="hidden sm:inline">{m.label}</span>
              {locked && <Lock size={11} className="text-amber" />}
            </>
          ),
        };
      })}
    />
  );
}

export function useCurrentView(listKey: string, views: ListViewKind[], fallback: ListViewKind = 'LIST') {
  const current = useUi((s) => s.viewByList[listKey]) ?? fallback;
  return views.includes(current) ? current : fallback;
}

export function useProjectMap() {
  const { data: projects = [] } = useProjects();
  return useMemo(() => new Map<string, ProjectDTO>(projects.map((p) => [p.id, p])), [projects]);
}

export function useMemberMap(workspaceId: string | undefined) {
  const { data: members = [] } = useMembers(workspaceId);
  return useMemo(() => new Map(members.map((m) => [m.userId, { name: m.name, email: m.email }])), [members]);
}

export function sortByOrder(tasks: TaskDTO[]) {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/** Midpoint ordering so a drag only rewrites the moved task. */
export function orderBetween(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export { usePrefersReducedMotion };
