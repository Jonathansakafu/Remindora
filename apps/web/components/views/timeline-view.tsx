'use client';
import { Button, cn, EmptyState, priorityMeta, withAlpha } from '@remindora/ui';
import type { TaskDTO } from '@remindora/types';
import { ChevronLeft, ChevronRight, GanttChart, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useFeature, useUpdateTask } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

const DAY_W = 44;

/** Timeline / Gantt: bars from start to due; drag to move, drag the right edge to resize. Premium. */
export function TimelineView({ tasks }: { tasks: TaskDTO[] }) {
  const entitled = useFeature('view.timeline');
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const select = useUi((s) => s.selectTask);
  const update = useUpdateTask();
  const [anchor, setAnchor] = useState(() => DateTime.now().setZone(tz).startOf('week'));
  const days = 28;
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; startX: number; dx: number } | null>(null);

  const rows = useMemo(
    () =>
      tasks
        .filter((t) => t.dueAt)
        .map((t) => {
          const end = DateTime.fromISO(t.dueAt!).setZone(tz).startOf('day');
          const start = t.startAt ? DateTime.fromISO(t.startAt).setZone(tz).startOf('day') : end;
          return { t, start, end: end < start ? start : end };
        })
        .sort((a, b) => a.start.toMillis() - b.start.toMillis()),
    [tasks, tz],
  );

  if (!entitled) {
    return (
      <EmptyState
        icon={<GanttChart size={22} />}
        title="Timeline is a Premium view"
        body="Plan work across weeks with start dates, durations and dependencies laid out as a Gantt chart."
        action={
          <Link href="/app/settings/billing">
            <Button variant="amber"><Sparkles size={15} /> See Premium</Button>
          </Link>
        }
      />
    );
  }
  if (!rows.length) return <EmptyState icon={<GanttChart size={22} />} title="Nothing on the timeline" body="Give tasks a start and due date to see them here." />;

  const offset = (d: DateTime) => Math.round(d.diff(anchor, 'days').days);

  function onPointerUp() {
    if (!drag) return;
    const row = rows.find((r) => r.t.id === drag.id);
    const deltaDays = Math.round(drag.dx / DAY_W);
    setDrag(null);
    if (!row || !deltaDays) return;
    const keepTime = (d: DateTime, iso: string | null) => {
      const orig = iso ? DateTime.fromISO(iso).setZone(tz) : d;
      return d.set({ hour: orig.hour, minute: orig.minute }).toUTC().toISO();
    };
    if (drag.mode === 'move') {
      update.mutate({
        task: row.t,
        patch: {
          dueAt: keepTime(row.end.plus({ days: deltaDays }), row.t.dueAt),
          ...(row.t.startAt ? { startAt: keepTime(row.start.plus({ days: deltaDays }), row.t.startAt) } : {}),
        },
      });
    } else {
      const newEnd = row.end.plus({ days: deltaDays });
      if (newEnd < row.start) return;
      update.mutate({ task: row.t, patch: { dueAt: keepTime(newEnd, row.t.dueAt), ...(!row.t.startAt ? { startAt: keepTime(row.start, row.t.dueAt) } : {}) } });
    }
  }

  const now = DateTime.now().setZone(tz);
  return (
    <div className="px-4 md:px-8" onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.startX })}>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="Earlier" onClick={() => setAnchor((a) => a.minus({ weeks: 1 }))}><ChevronLeft size={16} /></Button>
        <Button size="sm" onClick={() => setAnchor(DateTime.now().setZone(tz).startOf('week'))}>This week</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Later" onClick={() => setAnchor((a) => a.plus({ weeks: 1 }))}><ChevronRight size={16} /></Button>
        <span className="text-sm text-ink-muted">{anchor.toFormat('d LLL')} – {anchor.plus({ days: days - 1 }).toFormat('d LLL yyyy')}</span>
      </div>
      <div ref={scroller} className="glass scroll-thin overflow-x-auto rounded-[22px]">
        <div style={{ width: 220 + days * DAY_W }}>
          <div className="sticky top-0 flex border-b border-line bg-surface/80 backdrop-blur">
            <div className="w-[220px] shrink-0 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Task</div>
            {Array.from({ length: days }).map((_, i) => {
              const d = anchor.plus({ days: i });
              return (
                <div key={i} className={cn('shrink-0 border-l border-line/50 py-1 text-center text-[10px] text-ink-faint', d.weekday >= 6 && 'bg-white/[0.02]', d.hasSame(now, 'day') && 'text-cyan')} style={{ width: DAY_W }}>
                  <div>{d.toFormat('ccccc')}</div>
                  <div className="font-display text-xs text-ink-muted">{d.day}</div>
                </div>
              );
            })}
          </div>
          {rows.map(({ t, start, end }) => {
            const color = priorityMeta[t.priority as keyof typeof priorityMeta].cssVar;
            const isDragging = drag?.id === t.id;
            const left = offset(start) * DAY_W + (isDragging && drag.mode === 'move' ? drag.dx : 0);
            const width = (offset(end) - offset(start) + 1) * DAY_W + (isDragging && drag.mode === 'resize' ? drag.dx : 0);
            return (
              <div key={t.id} className="flex items-center border-b border-line/40 hover:bg-white/[0.02]" style={{ height: 40 }}>
                <button type="button" onClick={() => select(t.id)} className="w-[220px] shrink-0 truncate px-3 text-left text-sm hover:text-cyan">{t.title}</button>
                <div className="relative h-full flex-1">
                  {t.dependsOn.length > 0 && <span aria-hidden className="absolute top-1/2 h-px w-3 -translate-y-1/2 bg-amber/60" style={{ left: left - 12 }} />}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`${t.title}: ${start.toFormat('d LLL')} to ${end.toFormat('d LLL')}`}
                    aria-valuetext={`${start.toFormat('d LLL')} to ${end.toFormat('d LLL')}`}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        const n = e.key === 'ArrowRight' ? 1 : -1;
                        update.mutate({ task: t, patch: { dueAt: DateTime.fromISO(t.dueAt!).plus({ days: n }).toUTC().toISO(), ...(t.startAt ? { startAt: DateTime.fromISO(t.startAt).plus({ days: n }).toUTC().toISO() } : {}) } });
                      }
                    }}
                    onPointerDown={(e) => setDrag({ id: t.id, mode: 'move', startX: e.clientX, dx: 0 })}
                    className={cn('absolute top-1/2 flex h-7 -translate-y-1/2 cursor-grab items-center rounded-lg px-2 text-[11px] font-medium text-ink', isDragging && 'cursor-grabbing shadow-[var(--shadow-lift)]', t.completedAt && 'opacity-50')}
                    style={{ left, width: Math.max(DAY_W - 6, width - 6), background: `linear-gradient(90deg, ${withAlpha(color, 0.33)}, ${withAlpha(color, 0.13)})`, border: `1px solid ${withAlpha(color, 0.53)}` }}
                  >
                    <span className="truncate">{t.title}</span>
                    <span
                      aria-hidden
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDrag({ id: t.id, mode: 'resize', startX: e.clientX, dx: 0 });
                      }}
                      className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-lg bg-white/20"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-faint">Drag a bar to move it, drag its right edge to change the due date, or focus a bar and use ← → keys.</p>
    </div>
  );
}
