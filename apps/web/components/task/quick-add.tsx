'use client';
import { parseQuickAdd } from '@remindora/core';
import { Badge, Button, Dialog, DialogContent, Kbd, Select, Spinner } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Flag, Hash, ListTodo, Repeat, Timer, User, BellRing } from 'lucide-react';
import { DateTime } from 'luxon';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { describeRepeat } from '@/lib/repeat';
import { mutateOrQueue, useSync } from '@/lib/offline';
import { reportError, scheduleTaskRefetch, useFeature, useProjects } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

const kindColor: Record<string, string> = { tag: '#A58CFF', priority: '#FFBC5C', project: '#7CF3B0', assignee: '#F5A3FF', date: '#60E9FF', time: '#60E9FF', recurrence: '#68BFFF', duration: '#9DEFFF', reminder: '#FF7A93' };

/** Global Quick Add with live natural-language parsing (works offline — parsing runs locally). */
export function QuickAdd() {
  const open = useUi((s) => s.quickAddOpen);
  const setOpen = useUi((s) => s.setQuickAdd);
  const select = useUi((s) => s.selectTask);
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const { data: projects = [] } = useProjects();
  const canDuration = useFeature('task.duration');
  const pathname = usePathname();
  const params = useSearchParams();
  const contextProject = pathname.startsWith('/app/project') ? params.get('id') : null;
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { timezone: tz }) : null), [text, tz]);
  const target = projectId || contextProject || '';

  // Render the input text with recognised tokens highlighted underneath a transparent textarea.
  const highlighted = useMemo(() => {
    if (!parsed) return text;
    const out: React.ReactNode[] = [];
    let i = 0;
    for (const t of parsed.tokens) {
      if (t.start > i) out.push(text.slice(i, t.start));
      out.push(
        <mark key={t.start} className="rounded-[4px] px-0 text-transparent" style={{ background: `${kindColor[t.kind]}33`, boxShadow: `0 0 0 1px ${kindColor[t.kind]}55` }}>
          {text.slice(t.start, t.end)}
        </mark>,
      );
      i = t.end;
    }
    out.push(text.slice(i));
    return out;
  }, [parsed, text]);

  async function submit() {
    if (!parsed || busy) return;
    setBusy(true);
    try {
      if (useSync.getState().online) {
        const res = await api<{ task: TaskDTO; dropped: string[] }>('/tasks/quick-add', { body: { text, projectId: target || undefined } });
        toast.success('Task added', { description: res.task.title, action: { label: 'Open', onClick: () => select(res.task.id) } });
        if (res.dropped.length) toast('Duration needs Premium — saved without it.');
      } else {
        // Offline: create from the locally parsed fields; the outbox replays it later.
        await mutateOrQueue({
          method: 'POST',
          path: '/tasks',
          body: {
            clientId: crypto.randomUUID(),
            title: parsed.title,
            projectId: target || undefined,
            priority: parsed.priority ?? 'NONE',
            tags: parsed.tags,
            dueAt: parsed.dueAt,
            allDay: parsed.allDay,
            recurrence: parsed.recurrence,
            checklist: [],
            dependsOn: [],
          },
        });
        toast('Saved offline — it will sync when you reconnect');
      }
      scheduleTaskRefetch(qc);
      setText('');
      setOpen(false);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  const chips: Array<{ icon: React.ElementType; label: string; muted?: boolean }> = [];
  if (parsed?.dueAt) {
    const d = DateTime.fromISO(parsed.dueAt).setZone(tz);
    chips.push({ icon: CalendarClock, label: parsed.allDay ? d.toFormat('ccc d LLL') : d.toFormat('ccc d LLL, HH:mm') });
  }
  if (parsed?.recurrence) chips.push({ icon: Repeat, label: describeRepeat(parsed.recurrence.rrule) + (parsed.recurrence.mode === 'FROM_COMPLETION' ? ' after completion' : '') });
  if (parsed?.priority) chips.push({ icon: Flag, label: parsed.priority.toLowerCase() });
  for (const t of parsed?.tags ?? []) chips.push({ icon: Hash, label: t });
  if (parsed?.projectName) chips.push({ icon: ListTodo, label: parsed.projectName });
  if (parsed?.assignee) chips.push({ icon: User, label: `@${parsed.assignee}` });
  if (parsed?.durationMinutes) chips.push({ icon: Timer, label: `${parsed.durationMinutes} min${canDuration ? '' : ' · Premium'}`, muted: !canDuration });
  for (const r of parsed?.reminderOffsets ?? []) chips.push({ icon: BellRing, label: `${r} min before` });

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && setText(''))}>
      <DialogContent title="Quick Add" hideTitle className="max-w-xl p-0">
        <div className="p-4">
          <label htmlFor="quick-add" className="sr-only">
            Describe the task
          </label>
          <div className="relative font-sans text-[17px] leading-7">
            <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-1 py-1 text-transparent">
              {highlighted}
            </div>
            <textarea
              id="quick-add"
              autoFocus
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Submit report every Friday at 4pm #work !high"
              className="relative w-full resize-none bg-transparent px-1 py-1 text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          <div className="mt-2 flex min-h-7 flex-wrap gap-1.5" aria-live="polite">
            {chips.map((c, i) => (
              <Badge key={i} tone={c.muted ? 'neutral' : 'cyan'} className="h-6 gap-1.5 px-2 text-xs">
                <c.icon size={12} /> {c.label}
              </Badge>
            ))}
            {parsed && parsed.title !== text.trim() && <span className="text-xs text-ink-faint">→ “{parsed.title}”</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Select aria-label="List" value={target} onChange={(e) => setProjectId(e.target.value)} className="h-8 w-auto min-w-36 text-xs">
            <option value="">Inbox</option>
            {projects.filter((p) => !p.isInbox && !p.archived).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <span className="hidden text-xs text-ink-faint sm:inline">
            <Kbd>#</Kbd> tag <Kbd>!</Kbd> priority <Kbd>~</Kbd> list <Kbd>@</Kbd> assignee
          </span>
          <Button variant="primary" size="sm" className="ml-auto" onClick={submit} disabled={!parsed || busy}>
            {busy ? <Spinner size={14} className="text-on-accent" /> : 'Add task'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
