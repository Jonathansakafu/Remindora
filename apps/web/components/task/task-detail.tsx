'use client';
import { Avatar, Badge, Button, cn, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, priorityMeta, Segmented, Select, Spinner, Switch, TaskCheck, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@remindora/ui';
import type { PriorityKey } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, Copy, Download, FileUp, Link2, Lock, MoreHorizontal, Paperclip, Plus, Repeat, Save, Sparkles, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fromLocalInput, relative, toLocalInput } from '@/lib/dates';
import { describeRepeat, REPEAT_PRESETS } from '@/lib/repeat';
import { keys, patchTaskCaches, reportError, scheduleTaskRefetch, useActivity, useAttachments, useComments, useCompleteTask, useDeleteTask, useEntitlements, useFeature, useMembers, useProjects, useTask, useTasks, useUpdateTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';
import { RichText } from './rich-text';

const REMINDER_OFFSETS = [
  { label: 'At due time', value: 0 },
  { label: '5 min before', value: 5 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
];

function Row({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2 py-1.5">
      <span className="flex items-center gap-2 text-xs text-ink-faint">
        <Icon size={14} /> {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PremiumLock({ feature }: { feature: string }) {
  return (
    <a href="/app/settings/billing" className="inline-flex items-center gap-1 text-xs text-amber hover:underline" title={`${feature} is a Premium feature`}>
      <Sparkles size={12} /> Premium
    </a>
  );
}

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: task, isLoading } = useTask(taskId);
  if (isLoading || !task) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  return <TaskDetailBody key={task.id} task={task} onClose={onClose} />;
}

function TaskDetailBody({ task, onClose }: { task: TaskDTO; onClose: () => void }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const me = useSession((s) => s.user?.id);
  const update = useUpdateTask();
  const complete = useCompleteTask();
  const del = useDeleteTask();
  const qc = useQueryClient();
  const { data: projects = [] } = useProjects();
  const { data: ent } = useEntitlements();
  const canDuration = useFeature('task.duration');
  const canConstant = useFeature('reminders.constant');
  const canChecklistReminders = useFeature('reminders.checklist');
  const canTemplates = useFeature('templates.custom');
  const project = projects.find((p) => p.id === task.projectId);
  const { data: members = [] } = useMembers(task.workspaceId);
  const shared = members.length > 1;
  const [title, setTitle] = useState(task.title);
  const [newSub, setNewSub] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const readOnly = !!task.deletedAt;

  useEffect(() => setTitle(task.title), [task.title]);

  const patch = (p: Record<string, unknown>) => update.mutate({ task, patch: p });
  const refresh = (t: TaskDTO) => {
    patchTaskCaches(qc, t);
    scheduleTaskRefetch(qc);
  };

  async function call<T>(fn: () => Promise<T>) {
    try {
      const out = await fn();
      if (out && typeof out === 'object' && 'id' in (out as object) && 'version' in (out as object)) refresh(out as unknown as TaskDTO);
      return out;
    } catch (e) {
      reportError(e);
    }
  }

  const checklistLimit = ent?.limits['checklistItemsPerTask.max'];
  const reminderLimit = ent?.limits['remindersPerTask.max'];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-line p-4">
        <div className="pt-1.5">
          <TaskCheck checked={!!task.completedAt} priority={task.priority as PriorityKey} label={`Complete ${task.title}`} disabled={readOnly} onChange={(next) => complete.mutate({ task, done: next })} />
        </div>
        <Textarea
          aria-label="Task title"
          value={title}
          disabled={readOnly}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="min-h-0 resize-none border-transparent bg-transparent px-1 py-1 font-display text-lg font-semibold [field-sizing:content] hover:border-transparent focus:border-line"
        />
        <button
          type="button"
          aria-label={task.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={task.isFavorite}
          onClick={() => call(() => api<TaskDTO>(`/tasks/${task.id}/favorite`, { method: 'PUT', body: { favorite: !task.isFavorite } }))}
          className="rounded-lg p-1.5 text-ink-faint hover:bg-white/5 hover:text-amber"
        >
          <Star size={17} className={cn(task.isFavorite && 'fill-amber text-amber')} />
        </button>
        <Menu>
          <MenuTrigger className="rounded-lg p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="Task actions">
            <MoreHorizontal size={17} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onSelect={() => call(() => api<TaskDTO>(`/tasks/${task.id}/duplicate`, { method: 'POST' })).then(() => toast.success('Duplicated'))}>
              <Copy size={15} /> Duplicate
            </MenuItem>
            <MenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/app/task?id=${task.id}`);
                toast('Link copied');
              }}
            >
              <Link2 size={15} /> Copy link
            </MenuItem>
            <MenuItem
              disabled={!canTemplates}
              onSelect={() => call(() => api('/templates/from', { body: { taskId: task.id, name: task.title } })).then((r) => r && toast.success('Saved as template'))}
            >
              <Save size={15} /> Save as template {!canTemplates && <Sparkles size={12} className="ml-auto text-amber" />}
            </MenuItem>
            <MenuItem onSelect={() => patch({ archived: !task.archived })}>{task.archived ? 'Unarchive' : 'Archive'}</MenuItem>
            <MenuSeparator />
            {task.deletedAt ? (
              <MenuItem onSelect={() => call(() => api<TaskDTO>(`/tasks/${task.id}/restore`, { method: 'POST' }))}>Restore from Trash</MenuItem>
            ) : (
              <MenuItem
                danger
                onSelect={() => {
                  del.mutate(task);
                  onClose();
                }}
              >
                <Trash2 size={15} /> Move to Trash
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink" aria-label="Close details">
          <X size={17} />
        </button>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {task.deletedAt && <p className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">This task is in the Trash.</p>}
        <section aria-label="Properties" className="divide-y divide-line/60">
          <Row label="List" icon={CalendarClock}>
            <Select aria-label="List" value={task.projectId} disabled={readOnly} onChange={(e) => patch({ projectId: e.target.value })} className="h-8 text-sm">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.isInbox ? 'Inbox' : p.name}
                </option>
              ))}
            </Select>
          </Row>
          {project && project.sections.length > 0 && (
            <Row label="Section" icon={CalendarClock}>
              <Select aria-label="Section" value={task.sectionId ?? ''} disabled={readOnly} onChange={(e) => patch({ sectionId: e.target.value || null })} className="h-8 text-sm">
                <option value="">No section</option>
                {project.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Row>
          )}
          <Row label="Priority" icon={CalendarClock}>
            <Segmented
              label="Priority"
              value={task.priority}
              onChange={(v) => !readOnly && patch({ priority: v })}
              options={(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((p) => ({ value: p, label: <span style={{ color: priorityMeta[p].cssVar }}>{priorityMeta[p].label}</span> }))}
            />
          </Row>
          <Row label="Due" icon={CalendarClock}>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Due date"
                type={task.allDay ? 'date' : 'datetime-local'}
                disabled={readOnly}
                value={toLocalInput(task.dueAt, tz, task.allDay)}
                onChange={(e) => {
                  const v = fromLocalInput(e.target.value, tz);
                  patch({ dueAt: v.iso, allDay: task.allDay });
                }}
                className="h-8 min-w-[196px] flex-1 text-sm"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                <Switch
                  checked={task.allDay}
                  disabled={readOnly}
                  aria-label="All day"
                  onCheckedChange={(allDay) => {
                    if (!task.dueAt) return patch({ allDay });
                    const local = toLocalInput(task.dueAt, tz, task.allDay).slice(0, 10);
                    patch({ allDay, dueAt: fromLocalInput(allDay ? local : `${local}T09:00`, tz).iso });
                  }}
                />
                All day
              </label>
              {task.dueAt && (
                <button type="button" aria-label="Clear due date" disabled={readOnly} onClick={() => patch({ dueAt: null, recurrence: null })} className="rounded p-1 text-ink-faint hover:text-ink">
                  <X size={14} />
                </button>
              )}
            </div>
          </Row>
          <Row label="Time block" icon={CalendarClock}>
            {canDuration ? (
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Start time"
                  type="datetime-local"
                  disabled={readOnly}
                  value={toLocalInput(task.startAt, tz, false)}
                  onChange={(e) => patch({ startAt: fromLocalInput(e.target.value, tz).iso })}
                  className="h-8 min-w-0 flex-1 text-sm"
                />
                <Input
                  aria-label="Duration in minutes"
                  type="number"
                  min={5}
                  step={5}
                  disabled={readOnly}
                  defaultValue={task.durationMinutes ?? ''}
                  placeholder="min"
                  onBlur={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null;
                    if (v !== task.durationMinutes) patch({ durationMinutes: v });
                  }}
                  className="h-8 w-16 shrink-0 text-sm"
                />
              </div>
            ) : (
              <PremiumLock feature="Duration & time blocking" />
            )}
          </Row>
          <Row label="Repeat" icon={Repeat}>
            <Select
              aria-label="Repeat"
              disabled={readOnly || !task.dueAt}
              value={task.recurrence?.rrule ?? ''}
              onChange={(e) => patch({ recurrence: e.target.value ? { rrule: e.target.value, mode: task.recurrence?.mode ?? 'FROM_DUE' } : null })}
              className="h-8 text-sm"
              title={!task.dueAt ? 'Set a due date first' : undefined}
            >
              {REPEAT_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              {task.recurrence && !REPEAT_PRESETS.some((p) => p.value === task.recurrence!.rrule) && <option value={task.recurrence.rrule}>{describeRepeat(task.recurrence.rrule)}</option>}
            </Select>
            {task.recurrence && (
              <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
                <Switch
                  checked={task.recurrence.mode === 'FROM_COMPLETION'}
                  aria-label="Repeat from completion date"
                  onCheckedChange={(v) => patch({ recurrence: { rrule: task.recurrence!.rrule, mode: v ? 'FROM_COMPLETION' : 'FROM_DUE' } })}
                />
                Count from when I complete it
              </label>
            )}
          </Row>
          {shared && (
            <Row label="Assignee" icon={CalendarClock}>
              <Select aria-label="Assignee" value={task.assigneeId ?? ''} disabled={readOnly} onChange={(e) => patch({ assigneeId: e.target.value || null })} className="h-8 text-sm">
                <option value="">Unassigned</option>
                {members
                  .filter((m) => m.role !== 'VIEWER')
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                      {m.userId === me ? ' (me)' : ''}
                    </option>
                  ))}
              </Select>
            </Row>
          )}
          <Row label="Tags" icon={CalendarClock}>
            <div className="flex flex-wrap items-center gap-1.5">
              {task.tags.map((t) => (
                <Badge key={t} tone="violet" className="h-6 gap-1">
                  #{t}
                  {!readOnly && (
                    <button type="button" aria-label={`Remove tag ${t}`} onClick={() => patch({ tags: task.tags.filter((x) => x !== t) })}>
                      <X size={11} />
                    </button>
                  )}
                </Badge>
              ))}
              {!readOnly && (
                <input
                  aria-label="Add tag"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value.replace(/\s/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagDraft) {
                      patch({ tags: [...task.tags, tagDraft.replace(/^#/, '').toLowerCase()] });
                      setTagDraft('');
                    }
                  }}
                  placeholder="+ tag"
                  className="h-6 w-20 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                />
              )}
            </div>
          </Row>
        </section>

        <section aria-labelledby="reminders-h" className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="reminders-h" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
              <Bell size={13} /> Reminders
            </h3>
            <span className="text-xs text-ink-faint">
              {task.reminders.filter((r) => !r.subtaskId).length}/{reminderLimit ?? '…'}
            </span>
          </div>
          <ul className="space-y-1.5">
            {task.reminders
              .filter((r) => !r.subtaskId)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg-elevated/50 px-3 py-2 text-sm">
                  <span className="flex-1">
                    {r.at ? toLocalInput(r.at, tz, false).replace('T', ' ') : (REMINDER_OFFSETS.find((o) => o.value === r.offsetMinutes)?.label ?? `${r.offsetMinutes} min before`)}
                    {r.constant && <span className="ml-2 text-xs text-amber">constant</span>}
                  </span>
                  <span className="text-xs text-ink-faint">{r.state === 'ACTIVE' && r.nextFireAt ? `next ${relative(r.nextFireAt)}` : r.state.toLowerCase()}</span>
                  {!readOnly && (
                    <button type="button" aria-label="Remove reminder" onClick={() => call(() => api<TaskDTO>(`/reminders/${r.id}`, { method: 'DELETE' }))} className="text-ink-faint hover:text-danger">
                      <X size={14} />
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {!readOnly && <AddReminder task={task} canConstant={canConstant} onAdd={(body) => call(() => api<TaskDTO>(`/tasks/${task.id}/reminders`, { body }))} />}
          <p className="mt-2 text-xs text-ink-faint">
            {task.priority === 'CRITICAL'
              ? 'Critical: alerts on every device and repeats until you complete, snooze or acknowledge it.'
              : task.priority === 'HIGH'
                ? 'High: repeats at your chosen interval until acknowledged.'
                : task.priority === 'MEDIUM'
                  ? 'Medium: one alert, with an optional follow-up.'
                  : 'Low/none: quiet notification-center item or morning digest.'}{' '}
            <a href="/app/settings/notifications" className="text-cyan hover:underline">
              Intervals & quiet hours
            </a>
          </p>
        </section>

        <section aria-labelledby="checklist-h" className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="checklist-h" className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Checklist
            </h3>
            <span className="text-xs text-ink-faint">
              {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}
              {checklistLimit ? ` · max ${checklistLimit}` : ''}
            </span>
          </div>
          <ul className="space-y-0.5">
            {task.subtasks.map((s) => (
              <li key={s.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-white/[0.03]">
                <TaskCheck checked={s.done} label={`Check ${s.title}`} disabled={readOnly} onChange={(done) => call(() => api<TaskDTO>(`/subtasks/${s.id}`, { method: 'PATCH', body: { done } }))} />
                <input
                  aria-label="Checklist item"
                  defaultValue={s.title}
                  disabled={readOnly}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && call(() => api<TaskDTO>(`/subtasks/${s.id}`, { method: 'PATCH', body: { title: e.target.value.trim() } }))}
                  className={cn('min-w-0 flex-1 bg-transparent text-sm focus:outline-none', s.done && 'text-ink-faint line-through')}
                />
                {canChecklistReminders && !readOnly && (
                  <input
                    type="datetime-local"
                    aria-label={`Reminder for ${s.title}`}
                    value={toLocalInput(s.remindAt, tz, false)}
                    onChange={(e) => call(() => api<TaskDTO>(`/subtasks/${s.id}`, { method: 'PATCH', body: { remindAt: fromLocalInput(e.target.value, tz).iso } }))}
                    className="hidden w-40 bg-transparent text-xs text-ink-faint group-hover:block focus:block"
                  />
                )}
                {!readOnly && (
                  <button type="button" aria-label={`Delete ${s.title}`} onClick={() => call(() => api<TaskDTO>(`/subtasks/${s.id}`, { method: 'DELETE' }))} className="opacity-0 text-ink-faint hover:text-danger group-hover:opacity-100 focus:opacity-100">
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <form
              className="mt-1 flex items-center gap-2 px-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                void call(() => api<TaskDTO>(`/tasks/${task.id}/subtasks`, { body: { title: newSub.trim() } }));
                setNewSub('');
              }}
            >
              <Plus size={15} className="text-ink-faint" />
              <input aria-label="New checklist item" value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add an item" className="h-8 flex-1 bg-transparent text-sm placeholder:text-ink-faint focus:outline-none" />
            </form>
          )}
        </section>

        <section aria-label="Description" className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</h3>
          <RichText value={task.description ?? ''} readOnly={readOnly} onSave={(html) => html !== (task.description ?? '') && patch({ description: html || null })} />
        </section>

        <Dependencies task={task} readOnly={readOnly} onChange={(dependsOn) => patch({ dependsOn })} />

        <Tabs defaultValue="comments" className="mt-6">
          <TabsList>
            <TabsTrigger value="comments">Comments {task.commentCount ? `(${task.commentCount})` : ''}</TabsTrigger>
            <TabsTrigger value="files">Files {task.attachmentCount ? `(${task.attachmentCount})` : ''}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="comments" className="mt-3">
            <Comments task={task} members={members} />
          </TabsContent>
          <TabsContent value="files" className="mt-3">
            <Attachments task={task} readOnly={readOnly} limit={ent?.limits['attachmentsPerDay.max']} />
          </TabsContent>
          <TabsContent value="history" className="mt-3">
            <History taskId={task.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AddReminder({ task, canConstant, onAdd }: { task: TaskDTO; canConstant: boolean; onAdd: (b: Record<string, unknown>) => void }) {
  const [offset, setOffset] = useState('0');
  const [constant, setConstant] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Select aria-label="Reminder offset" value={offset} onChange={(e) => setOffset(e.target.value)} className="h-8 w-auto text-sm" disabled={!task.dueAt}>
        {REMINDER_OFFSETS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="Keeps alerting until you act">
        <Switch checked={constant} onCheckedChange={setConstant} disabled={!canConstant} aria-label="Constant reminder" /> Constant {!canConstant && <Sparkles size={11} className="text-amber" />}
      </label>
      <Button size="sm" disabled={!task.dueAt} title={!task.dueAt ? 'Set a due date first' : undefined} onClick={() => onAdd({ offsetMinutes: Number(offset), constant })}>
        <Plus size={14} /> Add reminder
      </Button>
    </div>
  );
}

function Dependencies({ task, readOnly, onChange }: { task: TaskDTO; readOnly: boolean; onChange: (ids: string[]) => void }) {
  const { data: candidates = [] } = useTasks({ projectId: task.projectId });
  const byId = useMemo(() => new Map(candidates.map((t) => [t.id, t])), [candidates]);
  const options = candidates.filter((t) => t.id !== task.id && !task.dependsOn.includes(t.id));
  if (!task.dependsOn.length && readOnly) return null;
  return (
    <section aria-labelledby="deps-h" className="mt-5">
      <h3 id="deps-h" className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        <Lock size={13} /> Blocked by
      </h3>
      <ul className="space-y-1">
        {task.dependsOn.map((id) => {
          const t = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className={cn('h-2 w-2 rounded-full', t?.completedAt ? 'bg-success' : 'bg-amber')} />
              <span className="flex-1 truncate">{t?.title ?? 'Task in another list'}</span>
              {!readOnly && (
                <button type="button" aria-label="Remove dependency" onClick={() => onChange(task.dependsOn.filter((x) => x !== id))} className="text-ink-faint hover:text-danger">
                  <X size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && options.length > 0 && (
        <Select aria-label="Add dependency" value="" onChange={(e) => e.target.value && onChange([...task.dependsOn, e.target.value])} className="mt-2 h-8 text-sm">
          <option value="">+ Add a task this depends on</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      )}
    </section>
  );
}

function Comments({ task, members }: { task: TaskDTO; members: Array<{ userId: string; name: string | null; email: string; role: string }> }) {
  const { data: comments = [], refetch } = useComments(task.id);
  const me = useSession((s) => s.user?.id);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const mentionQuery = body.match(/@([\w.-]*)$/)?.[1];
  const suggestions = mentionQuery !== undefined ? members.filter((m) => m.userId !== me && (m.name ?? m.email).toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5) : [];
  const qc = useQueryClient();

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    const mentions = members.filter((m) => body.includes(`@${(m.name ?? m.email).split(' ')[0]}`)).map((m) => m.userId);
    try {
      await api(`/tasks/${task.id}/comments`, { body: { body: body.trim(), mentions } });
      setBody('');
      await refetch();
      qc.invalidateQueries({ queryKey: keys.task(task.id) });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar name={c.authorName} size={26} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-faint">
                <span className="font-medium text-ink-muted">{c.authorName}</span> · {relative(c.createdAt)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </div>
          </li>
        ))}
        {!comments.length && <li className="text-sm text-ink-faint">No comments yet.</li>}
      </ul>
      <div className="relative mt-3">
        {suggestions.length > 0 && (
          <ul className="glass-strong absolute bottom-full mb-1 w-full rounded-xl p-1" role="listbox" aria-label="Mention suggestions">
            {suggestions.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5"
                  onClick={() => setBody(body.replace(/@[\w.-]*$/, `@${(m.name ?? m.email).split(' ')[0]} `))}
                >
                  <Avatar name={m.name ?? m.email} size={20} /> {m.name ?? m.email}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          aria-label="Write a comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
          placeholder={members.length > 1 ? 'Comment… use @ to mention' : 'Add a note to history…'}
          className="min-h-16"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" onClick={send} disabled={busy || !body.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function Attachments({ task, readOnly, limit }: { task: TaskDTO; readOnly: boolean; limit?: number }) {
  const { data: files = [], refetch } = useAttachments(task.id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function upload(file: File) {
    setBusy(true);
    try {
      const { attachment, upload } = await api<{ attachment: { id: string }; upload: { url: string; headers: Record<string, string> } }>(`/tasks/${task.id}/attachments`, {
        body: { fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size },
      });
      const res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
      if (!res.ok) throw new Error('Upload failed');
      await api(`/attachments/${attachment.id}/complete`, { method: 'POST' });
      await refetch();
      qc.invalidateQueries({ queryKey: keys.task(task.id) });
      toast.success('Attached');
    } catch (e) {
      reportError(e, 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="space-y-1.5">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg-elevated/50 px-3 py-2 text-sm">
            <Paperclip size={14} className="text-ink-faint" />
            <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
            <span className="text-xs text-ink-faint">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span>
            <button
              type="button"
              aria-label={`Download ${f.fileName}`}
              onClick={async () => {
                const { url } = await api<{ url: string }>(`/attachments/${f.id}/url`);
                window.open(url, '_blank', 'noopener');
              }}
              className="text-ink-faint hover:text-cyan"
            >
              <Download size={14} />
            </button>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Delete ${f.fileName}`}
                onClick={async () => {
                  await api(`/attachments/${f.id}`, { method: 'DELETE' }).catch(reportError);
                  await refetch();
                }}
                className="text-ink-faint hover:text-danger"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
        {!files.length && <li className="text-sm text-ink-faint">No files attached.</li>}
      </ul>
      {!readOnly && (
        <>
          <input ref={input} type="file" className="sr-only" aria-label="Choose a file to attach" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" className="mt-3" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner size={14} /> : <FileUp size={14} />} Attach file
          </Button>
          {limit !== undefined && <p className="mt-1.5 text-xs text-ink-faint">Your plan allows {limit} attachment{limit === 1 ? '' : 's'} per day.</p>}
        </>
      )}
    </div>
  );
}

function History({ taskId }: { taskId: string }) {
  const { data } = useActivity(taskId);
  if (!data) return <Spinner />;
  return (
    <div>
      <ol className="space-y-2 border-l border-line pl-4">
        {data.events.map((e) => (
          <li key={e.id} className="relative text-sm">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-cyan/70" />
            <span className="text-ink">{e.actorName ?? 'Someone'}</span> <span className="text-ink-muted">{e.verb.replace(/_/g, ' ')}</span>
            {Array.isArray((e.data as { fields?: string[] }).fields) && <span className="text-ink-faint"> {(e.data as { fields: string[] }).fields.join(', ')}</span>}
            <span className="block text-xs text-ink-faint">{relative(e.createdAt)}</span>
          </li>
        ))}
      </ol>
      {data.truncated && (
        <p className="mt-3 text-xs text-ink-faint">
          Showing the last 7 days. <a href="/app/settings/billing" className="text-amber hover:underline">Premium keeps full history.</a>
        </p>
      )}
    </div>
  );
}
