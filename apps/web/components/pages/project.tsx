'use client';
import { Button, Dialog, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, projectPalette, Select, Spinner, Switch } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, FolderX, MoreHorizontal, Palette, Save, Settings2, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { keys, reportError, useFeature, usePrefs, useProjects, useTasks, useWorkspaces } from '@/lib/queries';
import { CalendarView } from '../views/calendar-view';
import { PageHeader, useCurrentView, ViewSwitcher } from '../views/common';
import { KanbanView } from '../views/kanban-view';
import { ListView } from '../views/list-view';
import { MatrixView } from '../views/matrix-view';
import { TimelineView } from '../views/timeline-view';

const VIEWS = ['LIST', 'KANBAN', 'CALENDAR', 'TIMELINE', 'AGENDA', 'MATRIX'] as const;

export function ProjectPage() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const qc = useQueryClient();
  const { data: projects, isLoading } = useProjects();
  const { data: workspaces = [] } = useWorkspaces();
  const project = projects?.find((p) => p.id === id);
  const [showDone, setShowDone] = useState(false);
  const { data: tasks = [] } = useTasks({ projectId: id, includeCompleted: showDone }, !!project);
  const view = useCurrentView(`project:${id}`, [...VIEWS], (project?.defaultView as (typeof VIEWS)[number]) ?? 'LIST');
  const [editing, setEditing] = useState(false);
  const canTemplates = useFeature('templates.custom');
  const { data: prefs } = usePrefs();
  const muted = prefs?.projectOverrides.find((o) => o.projectId === id)?.muted ?? false;
  const ws = workspaces.find((w) => w.id === project?.workspaceId);

  if (isLoading) return <div className="grid place-items-center py-20"><Spinner /></div>;
  if (!project) return <EmptyState icon={<FolderX size={22} />} title="List not found" body="It may have been deleted, or you no longer have access." />;

  const title = project.isInbox ? 'Inbox' : project.name;
  return (
    <div className={view === 'KANBAN' || view === 'CALENDAR' || view === 'TIMELINE' ? '' : 'mx-auto max-w-5xl'}>
      <PageHeader
        title={title}
        color={project.isInbox ? undefined : project.color}
        subtitle={<>{ws && !ws.isPersonal && <span className="mr-2 text-violet">{ws.name}</span>}{project.taskCount} open</>}
        actions={
          <Menu>
            <MenuTrigger className="rounded-xl p-2 text-ink-muted hover:bg-white/5" aria-label="List options">
              <MoreHorizontal size={18} />
            </MenuTrigger>
            <MenuContent align="end">
              {!project.isInbox && <MenuItem onSelect={() => setEditing(true)}><Settings2 size={15} /> Edit list</MenuItem>}
              <MenuItem onSelect={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} completed</MenuItem>
              <MenuItem
                onSelect={async () => {
                  await api(`/notifications/preferences/projects/${id}`, muted ? { method: 'DELETE' } : { method: 'PUT', body: { muted: true } }).catch(reportError);
                  qc.invalidateQueries({ queryKey: keys.prefs });
                  toast(muted ? 'Notifications on for this list' : 'Muted — only silent notification-center items');
                }}
              >
                <BellOff size={15} /> {muted ? 'Unmute' : 'Mute'} notifications
              </MenuItem>
              <MenuItem disabled={!canTemplates} onSelect={() => api('/templates/from', { body: { projectId: id, name: project.name } }).then(() => toast.success('Saved as template')).catch(reportError)}>
                <Save size={15} /> Save as template
              </MenuItem>
              {ws && !ws.isPersonal && <MenuItem onSelect={() => router.push(`/app/settings/workspace?id=${ws.id}`)}>Members & sharing</MenuItem>}
              {!project.isInbox && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    onSelect={async () => {
                      if (!confirm(`Delete “${project.name}” and move its tasks to Trash?`)) return;
                      try {
                        await api(`/projects/${id}`, { method: 'DELETE' });
                        qc.invalidateQueries({ queryKey: keys.projects });
                        router.replace('/app/inbox');
                      } catch (e) {
                        reportError(e);
                      }
                    }}
                  >
                    <Trash2 size={15} /> Delete list
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        }
      >
        <ViewSwitcher listKey={`project:${id}`} views={[...VIEWS]} fallback={(project.defaultView as (typeof VIEWS)[number]) ?? 'LIST'} />
      </PageHeader>

      {view === 'KANBAN' ? (
        <KanbanView tasks={tasks} project={project} />
      ) : view === 'CALENDAR' ? (
        <CalendarView projectId={project.id} />
      ) : view === 'TIMELINE' ? (
        <TimelineView tasks={tasks} />
      ) : view === 'MATRIX' ? (
        <MatrixView tasks={tasks} />
      ) : view === 'AGENDA' ? (
        <div className="px-1 md:px-5"><ListView tasks={tasks.filter((t) => t.dueAt)} grouping="due" project={project} showProject={false} emptyTitle="No scheduled tasks" addDefaults={null} /></div>
      ) : (
        <div className="px-1 md:px-5">
          <ListView tasks={tasks} grouping={project.sections.length ? 'sections' : 'none'} project={project} showProject={false} emptyTitle="This list is empty" emptyBody="Add a task below or press N." addDefaults={{ projectId: project.id }} sortable />
        </div>
      )}

      <EditProject open={editing} onOpenChange={setEditing} project={project} />
    </div>
  );
}

function EditProject({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project: { id: string; name: string; color: string; defaultView: string; archived: boolean } }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [defaultView, setDefaultView] = useState(project.defaultView);
  const [archived, setArchived] = useState(project.archived);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit list">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/projects/${project.id}`, { method: 'PATCH', body: { name, color, defaultView, archived } });
              qc.invalidateQueries({ queryKey: keys.projects });
              onOpenChange(false);
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <Field label="Name" htmlFor="pname"><Input id="pname" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <fieldset>
            <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-faint"><Palette size={12} /> Color</legend>
            <div className="flex flex-wrap gap-2">
              {projectPalette.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c} className="h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-ink" style={{ background: c }} />
              ))}
            </div>
          </fieldset>
          <Field label="Default view" htmlFor="pview">
            <Select id="pview" value={defaultView} onChange={(e) => setDefaultView(e.target.value)}>
              {VIEWS.map((v) => <option key={v} value={v}>{v.charAt(0) + v.slice(1).toLowerCase()}</option>)}
            </Select>
          </Field>
          <label className="flex items-center justify-between text-sm">Archive this list <Switch checked={archived} onCheckedChange={setArchived} /></label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
