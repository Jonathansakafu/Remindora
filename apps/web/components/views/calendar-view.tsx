'use client';
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Button, cn, priorityMeta, Segmented, Spinner } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { keys, useFeature, useTasks, useUpdateTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi, type CalendarMode } from '@/lib/ui-store';

interface CalEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  calendar: string;
  color: string;
}
interface CalData {
  tasks: TaskDTO[];
  occurrences: Array<{ taskId: string; at: string }>;
  events: CalEvent[];
}

const HOUR = 48; // px per hour in time grids
const PREMIUM_MODES: CalendarMode[] = ['day', '3day', 'multiweek', 'year'];

function range(mode: CalendarMode, anchor: DateTime, weekStart: number) {
  const startOfWeek = (d: DateTime) => d.minus({ days: (d.weekday - weekStart + 7) % 7 }).startOf('day');
  switch (mode) {
    case 'day':
      return { from: anchor.startOf('day'), days: 1 };
    case '3day':
      return { from: anchor.startOf('day'), days: 3 };
    case 'week':
      return { from: startOfWeek(anchor), days: 7 };
    case 'multiweek':
      return { from: startOfWeek(anchor), days: 28 };
    case 'month': {
      const first = startOfWeek(anchor.startOf('month'));
      const last = startOfWeek(anchor.endOf('month')).plus({ days: 6 });
      return { from: first, days: Math.round(last.diff(first, 'days').days) + 1 };
    }
    case 'year':
      return { from: anchor.startOf('year'), days: anchor.daysInYear };
    case 'agenda':
      return { from: anchor.startOf('day'), days: 14 };
  }
}

function blockTimes(t: TaskDTO, tz: string) {
  const due = t.dueAt ? DateTime.fromISO(t.dueAt).setZone(tz) : null;
  // Time-blocked tasks span start→end; due-only tasks are drawn as a short block starting at the due time.
  const start = t.startAt ? DateTime.fromISO(t.startAt).setZone(tz) : due;
  if (!start) return null;
  const stop = t.startAt && t.durationMinutes ? start.plus({ minutes: t.durationMinutes }) : t.startAt && due && due > start ? due : start.plus({ minutes: t.durationMinutes ?? 30 });
  return { start, end: stop };
}

function TaskChip({ task, tz, style, compact, ghost }: { task: TaskDTO; tz: string; style?: React.CSSProperties; compact?: boolean; ghost?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ghost ? `ghost-${task.id}-${style?.top}` : task.id, disabled: ghost || !!task.completedAt });
  const select = useUi((s) => s.selectTask);
  const color = priorityMeta[task.priority as keyof typeof priorityMeta].color;
  const t = blockTimes(task, tz);
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...(ghost ? {} : attributes)}
      {...(ghost ? {} : listeners)}
      onClick={() => select(task.id)}
      style={{ ...style, borderColor: `${color}66`, background: ghost ? 'transparent' : `linear-gradient(135deg, ${color}26, ${color}10)` }}
      className={cn(
        'block w-full overflow-hidden rounded-lg border px-1.5 text-left text-[11.5px] leading-tight text-ink transition-opacity',
        compact ? 'h-5 truncate' : 'py-0.5 [&>span:first-child]:line-clamp-2',
        ghost && 'border-dashed opacity-60',
        task.completedAt && 'opacity-45 line-through',
        isDragging && 'opacity-30',
      )}
      aria-label={`${task.title}${t && !task.allDay ? ` at ${t.start.toFormat('HH:mm')}` : ''}`}
    >
      <span className="font-medium">{ghost && <Repeat size={10} className="mr-1 inline" />}{task.title}</span>
      {!compact && t && !task.allDay && t.end.diff(t.start, 'minutes').minutes >= 45 && <span className="block text-[10px] text-ink-muted">{t.start.toFormat('HH:mm')}–{t.end.toFormat('HH:mm')}</span>}
    </button>
  );
}

function DayColumn({ day, children, onDropHint }: { day: DateTime; children: React.ReactNode; onDropHint?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `time:${day.toISODate()}` });
  return (
    <div ref={setNodeRef} className={cn('relative border-l border-line/70', isOver && 'bg-cyan/[0.05]')} style={{ height: HOUR * 24 }} data-hint={onDropHint}>
      {Array.from({ length: 24 }).map((_, h) => (
        <div key={h} className="border-b border-line/40" style={{ height: HOUR }} />
      ))}
      {children}
    </div>
  );
}

function AllDayCell({ day, children }: { day: DateTime; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.toISODate()}` });
  return (
    <div ref={setNodeRef} className={cn('min-h-8 space-y-0.5 border-l border-line/70 p-0.5', isOver && 'bg-cyan/[0.07]')}>
      {children}
    </div>
  );
}

function MonthCell({ day, inMonth, today, children, onOpen }: { day: DateTime; inMonth: boolean; today: boolean; children: React.ReactNode; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.toISODate()}` });
  return (
    <div ref={setNodeRef} className={cn('min-h-[104px] border-b border-l border-line/60 p-1', !inMonth && 'bg-black/10 opacity-60', isOver && 'bg-cyan/[0.07]')}>
      <button type="button" onClick={onOpen} className={cn('mb-1 grid h-6 w-6 place-items-center rounded-full text-xs', today ? 'bg-cyan font-bold text-[#06122e]' : 'text-ink-muted hover:bg-white/5')} aria-label={day.toFormat('cccc d LLLL')}>
        {day.day}
      </button>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function CalendarView({ projectId }: { projectId?: string }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const weekStart = useSession((s) => (s.user?.weekStartsOn === 0 ? 7 : s.user?.weekStartsOn === 6 ? 6 : 1));
  const mode = useUi((s) => s.calendarMode);
  const setMode = useUi((s) => s.setCalendarMode);
  const multi = useFeature('view.calendarMulti');
  const canBlock = useFeature('task.duration');
  const effectiveMode: CalendarMode = PREMIUM_MODES.includes(mode) && !multi ? 'week' : mode;
  const [anchor, setAnchor] = useState<DateTime>(() => DateTime.now().setZone(tz));
  const { from, days } = range(effectiveMode, anchor, weekStart);
  const to = from.plus({ days }).minus({ milliseconds: 1 });
  const fromIso = from.toUTC().toISO()!;
  const toIso = to.toUTC().toISO()!;
  const viewParam = effectiveMode === 'agenda' ? 'agenda' : effectiveMode;
  const { data, isLoading, error } = useQuery({
    queryKey: [...keys.calendar(fromIso, toIso, viewParam), projectId],
    queryFn: () => api<CalData>('/calendar', { query: { from: fromIso, to: toIso, view: viewParam, projectId } }),
  });
  const { data: inbox = [] } = useTasks({ view: 'inbox' }, !projectId);
  const { data: projectTasks = [] } = useTasks({ projectId }, !!projectId);
  const unscheduled = (projectId ? projectTasks : inbox).filter((t) => !t.dueAt && !t.completedAt).slice(0, 30);
  const update = useUpdateTask();
  const [dragging, setDragging] = useState<TaskDTO | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = HOUR * 7;
  }, [effectiveMode]);

  const now = DateTime.now().setZone(tz);
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => from.plus({ days: i })), [from, days]);
  const tasks = data?.tasks ?? [];
  const taskById = useMemo(() => new Map([...tasks, ...unscheduled].map((t) => [t.id, t])), [tasks, unscheduled]);
  const onDay = (d: DateTime) => tasks.filter((t) => t.dueAt && DateTime.fromISO(t.dueAt).setZone(tz).hasSame(d, 'day'));
  const ghostsOn = (d: DateTime) =>
    (data?.occurrences ?? []).filter((o) => DateTime.fromISO(o.at).setZone(tz).hasSame(d, 'day')).map((o) => ({ task: taskById.get(o.taskId), at: o.at })).filter((g) => g.task);
  const eventsOn = (d: DateTime) => (data?.events ?? []).filter((e) => DateTime.fromISO(e.startAt).setZone(tz) <= d.endOf('day') && DateTime.fromISO(e.endAt).setZone(tz) > d.startOf('day'));

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = taskById.get(String(e.active.id));
    const over = e.over?.id ? String(e.over.id) : null;
    if (!task || !over) return;
    const [kind, iso] = over.split(':') as ['time' | 'day', string];
    const day = DateTime.fromISO(iso!, { zone: tz });
    if (kind === 'day') {
      // Month cell / all-day lane: keep the time for timed tasks, otherwise all-day.
      const prev = task.dueAt && !task.allDay ? DateTime.fromISO(task.dueAt).setZone(tz) : null;
      const target = prev ? day.set({ hour: prev.hour, minute: prev.minute }) : day.startOf('day');
      update.mutate({ task, patch: { dueAt: target.toUTC().toISO(), allDay: !prev, ...(task.startAt && prev ? { startAt: target.minus({ minutes: task.durationMinutes ?? 0 }).toUTC().toISO() } : {}) } });
      return;
    }
    const top = (e.active.rect.current.translated?.top ?? 0) - (e.over!.rect.top ?? 0);
    const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round(((top / HOUR) * 60) / 15) * 15));
    const start = day.startOf('day').plus({ minutes });
    if (canBlock) {
      const duration = task.durationMinutes ?? 60;
      update.mutate({ task, patch: { startAt: start.toUTC().toISO(), dueAt: start.plus({ minutes: duration }).toUTC().toISO(), durationMinutes: duration, allDay: false } });
    } else {
      update.mutate({ task, patch: { dueAt: start.toUTC().toISO(), allDay: false } });
    }
  }

  const step = (dir: number) => {
    const unit = effectiveMode === 'month' ? { months: dir } : effectiveMode === 'year' ? { years: dir } : effectiveMode === 'multiweek' ? { weeks: 4 * dir } : { days: dir * (effectiveMode === 'week' ? 7 : effectiveMode === '3day' ? 3 : effectiveMode === 'agenda' ? 14 : 1) };
    setAnchor((a) => a.plus(unit));
  };
  const title = effectiveMode === 'year' ? anchor.toFormat('yyyy') : effectiveMode === 'month' ? anchor.toFormat('LLLL yyyy') : `${from.toFormat('d LLL')} – ${to.toFormat('d LLL yyyy')}`;

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(taskById.get(String(e.active.id)) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-8">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" onClick={() => setAnchor(DateTime.now().setZone(tz))}>Today</Button>
          <Button size="icon-sm" variant="ghost" onClick={() => step(1)} aria-label="Next">
            <ChevronRight size={16} />
          </Button>
        </div>
        <h2 className="font-display text-lg font-semibold" aria-live="polite">{title}</h2>
        {isLoading && <Spinner size={14} />}
        <div className="ml-auto">
          <Segmented
            label="Calendar view"
            value={effectiveMode}
            onChange={(m) => setMode(m)}
            options={(['day', '3day', 'week', 'month', 'multiweek', 'year', 'agenda'] as CalendarMode[]).map((m) => {
              const locked = PREMIUM_MODES.includes(m) && !multi;
              return { value: m, disabled: locked, title: locked ? 'Premium calendar view' : undefined, label: <>{{ day: 'Day', '3day': '3 days', week: 'Week', month: 'Month', multiweek: '4 weeks', year: 'Year', agenda: 'Agenda' }[m]}{locked && <Lock size={10} className="text-amber" />}</> };
            })}
          />
        </div>
      </div>
      {error instanceof ApiError && error.isPlanGate && <p className="px-8 text-sm text-amber">{error.message}</p>}

      <div className="flex gap-4 px-4 md:px-8">
        <div className="glass min-w-0 flex-1 overflow-hidden rounded-[22px]">
          {(effectiveMode === 'day' || effectiveMode === '3day' || effectiveMode === 'week') && (
            <div>
              <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${days}, minmax(0,1fr))` }}>
                <div />
                {dayList.map((d) => (
                  <div key={d.toISODate()} className="border-l border-line/70 px-2 py-2 text-center">
                    <div className="text-[11px] uppercase tracking-wider text-ink-faint">{d.toFormat('ccc')}</div>
                    <div className={cn('mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full font-display text-sm', d.hasSame(now, 'day') && 'bg-cyan font-bold text-[#06122e]')}>{d.day}</div>
                  </div>
                ))}
                <div className="px-1 py-1 text-right text-[10px] text-ink-faint">all-day</div>
                {dayList.map((d) => (
                  <AllDayCell key={d.toISODate()} day={d}>
                    {onDay(d).filter((t) => t.allDay).map((t) => <TaskChip key={t.id} task={t} tz={tz} compact />)}
                    {eventsOn(d).filter((e) => e.allDay).map((e) => (
                      <div key={e.id} className="h-5 truncate rounded-md px-1.5 text-[11px]" style={{ background: `${e.color}30`, color: e.color }} title={`${e.title} · ${e.calendar}`}>{e.title}</div>
                    ))}
                  </AllDayCell>
                ))}
              </div>
              <div ref={gridRef} className="scroll-thin relative max-h-[calc(100dvh-280px)] overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days}, minmax(0,1fr))` }}>
                  <div>
                    {Array.from({ length: 24 }).map((_, h) => (
                      <div key={h} className="pr-2 text-right text-[10px] text-ink-faint" style={{ height: HOUR }}>
                        {h ? `${String(h).padStart(2, '0')}:00` : ''}
                      </div>
                    ))}
                  </div>
                  {dayList.map((d) => (
                    <DayColumn key={d.toISODate()} day={d}>
                      {d.hasSame(now, 'day') && <div aria-hidden className="absolute inset-x-0 z-10 h-0.5 bg-danger shadow-[0_0_8px_var(--color-danger)]" style={{ top: ((now.hour * 60 + now.minute) / 60) * HOUR }} />}
                      {eventsOn(d).filter((e) => !e.allDay).map((e) => {
                        const s = DateTime.fromISO(e.startAt).setZone(tz);
                        const en = DateTime.fromISO(e.endAt).setZone(tz);
                        const top = s.hasSame(d, 'day') ? ((s.hour * 60 + s.minute) / 60) * HOUR : 0;
                        const height = Math.max(18, (en.diff(s, 'minutes').minutes / 60) * HOUR);
                        return (
                          <div key={e.id} className="absolute inset-x-1 overflow-hidden rounded-lg border-l-2 px-1.5 py-0.5 text-[11px]" style={{ top, height, background: `${e.color}1f`, borderColor: e.color }} title={`${e.title} · ${e.calendar}`}>
                            <span className="font-medium text-ink">{e.title}</span>
                          </div>
                        );
                      })}
                      {onDay(d).filter((t) => !t.allDay).map((t) => {
                        const b = blockTimes(t, tz)!;
                        const top = ((b.start.hour * 60 + b.start.minute) / 60) * HOUR;
                        const height = Math.max(22, (b.end.diff(b.start, 'minutes').minutes / 60) * HOUR);
                        return (
                          <div key={t.id} className="absolute inset-x-1 z-[5]" style={{ top, height }}>
                            <TaskChip task={t} tz={tz} style={{ height: '100%' }} />
                          </div>
                        );
                      })}
                      {ghostsOn(d).map((g) => {
                        const at = DateTime.fromISO(g.at).setZone(tz);
                        return g.task!.allDay ? null : (
                          <div key={g.at + g.task!.id} className="absolute inset-x-1" style={{ top: ((at.hour * 60 + at.minute) / 60) * HOUR, height: 24 }}>
                            <TaskChip task={g.task!} tz={tz} ghost style={{ height: '100%', top: at.toMillis() }} />
                          </div>
                        );
                      })}
                    </DayColumn>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(effectiveMode === 'month' || effectiveMode === 'multiweek') && (
            <div>
              <div className="grid grid-cols-7 border-b border-line">
                {dayList.slice(0, 7).map((d) => (
                  <div key={d.weekday} className="border-l border-line/60 px-2 py-2 text-[11px] uppercase tracking-wider text-ink-faint">{d.toFormat('ccc')}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {dayList.map((d) => (
                  <MonthCell key={d.toISODate()} day={d} inMonth={effectiveMode === 'multiweek' || d.month === anchor.month} today={d.hasSame(now, 'day')} onOpen={() => (setAnchor(d), multi && setMode('day'))}>
                    {eventsOn(d).slice(0, 2).map((e) => (
                      <div key={e.id} className="h-5 truncate rounded-md px-1.5 text-[11px]" style={{ background: `${e.color}26`, color: e.color }}>{e.title}</div>
                    ))}
                    {onDay(d).slice(0, 4).map((t) => <TaskChip key={t.id} task={t} tz={tz} compact />)}
                    {ghostsOn(d).slice(0, 2).map((g) => <TaskChip key={g.at} task={g.task!} tz={tz} compact ghost style={{ top: 0 }} />)}
                    {onDay(d).length > 4 && <div className="px-1 text-[10px] text-ink-faint">+{onDay(d).length - 4} more</div>}
                  </MonthCell>
                ))}
              </div>
            </div>
          )}

          {effectiveMode === 'year' && (
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }).map((_, m) => {
                const month = anchor.startOf('year').plus({ months: m });
                const lead = (month.weekday - weekStart + 7) % 7;
                return (
                  <div key={m}>
                    <h3 className="mb-1.5 text-sm font-semibold">{month.toFormat('LLLL')}</h3>
                    <div className="grid grid-cols-7 gap-0.5">
                      {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
                      {Array.from({ length: month.daysInMonth! }).map((_, i) => {
                        const d = month.plus({ days: i });
                        const n = onDay(d).length;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => (setAnchor(d), setMode('day'))}
                            className={cn('grid aspect-square place-items-center rounded-md text-[10px]', d.hasSame(now, 'day') ? 'bg-cyan font-bold text-[#06122e]' : 'text-ink-muted hover:bg-white/5')}
                            style={n && !d.hasSame(now, 'day') ? { background: `rgb(96 233 255 / ${Math.min(0.15 + n * 0.12, 0.6)})`, color: 'var(--color-ink)' } : undefined}
                            aria-label={`${d.toFormat('d LLLL')}: ${n} tasks`}
                          >
                            {d.day}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {effectiveMode === 'agenda' && (
            <ol className="divide-y divide-line/60">
              {dayList.map((d) => {
                const items = onDay(d);
                const evs = eventsOn(d);
                if (!items.length && !evs.length) return null;
                return (
                  <li key={d.toISODate()} className="flex gap-4 px-4 py-3">
                    <div className="w-16 shrink-0 text-center">
                      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{d.toFormat('ccc')}</div>
                      <div className={cn('font-display text-2xl', d.hasSame(now, 'day') && 'text-cyan')}>{d.day}</div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      {evs.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 text-sm">
                          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                          <span className="w-24 shrink-0 text-xs text-ink-faint">{e.allDay ? 'all day' : DateTime.fromISO(e.startAt).setZone(tz).toFormat('HH:mm')}</span>
                          <span className="truncate text-ink-muted">{e.title}</span>
                        </div>
                      ))}
                      {items.map((t) => <TaskChip key={t.id} task={t} tz={tz} />)}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {effectiveMode !== 'year' && effectiveMode !== 'agenda' && (
          <aside aria-label="Unscheduled tasks" className="hidden w-60 shrink-0 xl:block">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Unscheduled</h3>
            <p className="mb-2 text-xs text-ink-faint">{canBlock ? 'Drag onto the calendar to time-block.' : 'Drag onto a day to schedule.'}</p>
            <div className="space-y-1.5">
              {unscheduled.map((t) => <TaskChip key={t.id} task={t} tz={tz} />)}
              {!unscheduled.length && <p className="text-xs text-ink-faint">Nothing waiting.</p>}
            </div>
          </aside>
        )}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <div className="w-48 rotate-[-2deg] rounded-lg shadow-[var(--shadow-lift)]"><TaskChip task={dragging} tz={tz} /></div>}</DragOverlay>
    </DndContext>
  );
}
