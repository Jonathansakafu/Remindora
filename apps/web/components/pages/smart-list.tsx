'use client';
import { Button, Spinner } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import { reportError, scheduleTaskRefetch, useTasks } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { smartListMeta, type SmartListKey } from '../shell/nav';
import { PageHeader, useCurrentView, ViewSwitcher } from '../views/common';
import { KanbanView } from '../views/kanban-view';
import { ListView } from '../views/list-view';
import { MatrixView } from '../views/matrix-view';
import { OrbitSummary } from '../orbit/orbit-summary';

export function SmartListPage({ list }: { list: SmartListKey }) {
  const meta = smartListMeta[list];
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const { data: tasks = [], isLoading } = useTasks({ view: list });
  const qc = useQueryClient();
  const readOnly = list === 'trash' || list === 'archive';
  const views = readOnly || list === 'completed' ? (['LIST'] as const) : (['LIST', 'KANBAN', 'MATRIX'] as const);
  const view = useCurrentView(list, [...views]);
  const now = DateTime.now().setZone(tz);
  const addDefaults =
    list === 'today' ? { dueAt: now.startOf('day').toUTC().toISO(), allDay: true } : list === 'inbox' ? {} : list === 'upcoming' ? { dueAt: now.plus({ days: 1 }).startOf('day').toUTC().toISO(), allDay: true } : null;

  const subtitle =
    list === 'today' ? now.toFormat('cccc, d LLLL') : list === 'trash' ? 'Items are deleted permanently after 30 days.' : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={meta.title}
        subtitle={subtitle}
        actions={
          list === 'trash' && tasks.length ? (
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!confirm('Permanently delete everything in Trash?')) return;
                try {
                  await api('/trash/empty', { method: 'POST' });
                  scheduleTaskRefetch(qc);
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              <Trash2 size={14} /> Empty trash
            </Button>
          ) : undefined
        }
      >
        {views.length > 1 && <ViewSwitcher listKey={list} views={[...views]} />}
      </PageHeader>
      {list === 'today' && (
        <div className="px-4 pb-4 md:px-8">
          <OrbitSummary />
        </div>
      )}
      {isLoading ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : view === 'KANBAN' ? (
        <KanbanView tasks={tasks} />
      ) : view === 'MATRIX' ? (
        <MatrixView tasks={tasks} />
      ) : (
        <div className="px-1 md:px-5">
          <ListView tasks={tasks} grouping={list === 'inbox' ? 'none' : list === 'completed' || list === 'trash' || list === 'archive' ? 'none' : 'due'} showProject={list !== 'inbox'} emptyTitle={meta.empty} addDefaults={addDefaults} readOnly={readOnly} sortable={list === 'inbox'} />
        </div>
      )}
    </div>
  );
}
