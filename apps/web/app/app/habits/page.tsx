'use client';
import { Button, Dialog, DialogContent, EmptyState, Field, GlassPanel, Heatmap, Input, projectPalette, Segmented, Sheet, Spinner, TaskCheck, BarChart } from '@remindora/ui';
import type { HabitDTO } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Plus, Trash2, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { PageHeader } from '@/components/views/common';
import { api } from '@/lib/api';
import { keys, reportError, useEntitlements, useHabits } from '@/lib/queries';
import { useSession } from '@/lib/session';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function HabitsPage() {
  const { data: habits = [], isLoading } = useHabits();
  const { data: ent } = useEntitlements();
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<HabitDTO | null>(null);
  const today = DateTime.now().setZone(tz);
  const last7 = Array.from({ length: 7 }, (_, i) => today.minus({ days: 6 - i }));

  async function toggle(h: HabitDTO, date: string, done: boolean) {
    qc.setQueryData<HabitDTO[]>(keys.habits, (list) => list?.map((x) => (x.id === h.id ? { ...x, checkIns: done ? [...x.checkIns, date] : x.checkIns.filter((d) => d !== date) } : x)));
    try {
      const updated = await api<HabitDTO>(`/habits/${h.id}/check-in`, { body: { date, done } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (list) => list?.map((x) => (x.id === h.id ? updated : x)));
    } catch (e) {
      reportError(e);
      qc.invalidateQueries({ queryKey: keys.habits });
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Habits"
        subtitle={ent ? `${habits.length} of ${ent.limits['habits.max']} habits` : undefined}
        actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={15} /> New habit</Button>}
      />
      <div className="px-4 md:px-8">
        {isLoading ? <Spinner /> : !habits.length ? (
          <EmptyState icon={<Flame size={22} />} title="Build a habit" body="Small daily or weekly actions, tracked with streaks and a heatmap." action={<Button variant="primary" onClick={() => setCreating(true)}>Create your first habit</Button>} />
        ) : (
          <ul className="space-y-2">
            {habits.map((h) => {
              const todayKey = today.toISODate()!;
              const doneToday = h.checkIns.includes(todayKey);
              return (
                <li key={h.id}>
                  <GlassPanel className="flex flex-wrap items-center gap-4 p-4">
                    <TaskCheck checked={doneToday} label={`Check in ${h.name} today`} onChange={(v) => toggle(h, todayKey, v)} />
                    <button type="button" onClick={() => setDetail(h)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: h.color }} />
                        <span className="truncate font-medium">{h.name}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-faint">
                        {h.frequency === 'WEEKLY' ? `${h.targetPerPeriod}× per week` : h.weekdays.length ? h.weekdays.map((d) => WEEKDAYS[d - 1]).join(' ') : 'Every day'}
                        {h.reminderTime && ` · reminder ${h.reminderTime}`}
                      </div>
                    </button>
                    <div className="flex gap-1" aria-label="Last 7 days">
                      {last7.map((d) => {
                        const key = d.toISODate()!;
                        const done = h.checkIns.includes(key);
                        return (
                          <button key={key} type="button" aria-pressed={done} aria-label={`${h.name} on ${d.toFormat('cccc d LLL')}`} onClick={() => toggle(h, key, !done)} className="grid h-8 w-8 place-items-center rounded-lg border text-[10px] transition-colors" style={{ borderColor: done ? h.color : 'var(--color-line)', background: done ? `${h.color}33` : 'transparent', color: done ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}>
                            {d.toFormat('ccccc')}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex w-20 items-center justify-end gap-1 text-sm" title="Current streak">
                      <Flame size={16} className={h.currentStreak ? 'text-amber' : 'text-ink-faint'} />
                      <span className="font-display text-lg font-semibold tabular-nums">{h.currentStreak}</span>
                    </div>
                  </GlassPanel>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <HabitForm open={creating} onOpenChange={setCreating} />
      {detail && <HabitDetail habit={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function HabitForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(projectPalette[0]);
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('DAILY');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [target, setTarget] = useState(3);
  const [reminder, setReminder] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New habit">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('/habits', { body: { name, color, frequency, weekdays: frequency === 'DAILY' ? weekdays : [], targetPerPeriod: frequency === 'WEEKLY' ? target : 1, reminderTime: reminder || null } });
              qc.invalidateQueries({ queryKey: keys.habits });
              onOpenChange(false);
              setName('');
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <Field label="Habit" htmlFor="hname"><Input id="hname" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Read 20 pages" /></Field>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {projectPalette.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full aria-checked:ring-2 aria-checked:ring-ink aria-checked:ring-offset-2 aria-checked:ring-offset-surface" style={{ background: c }} />
            ))}
          </div>
          <Segmented label="Frequency" value={frequency} onChange={setFrequency} options={[{ value: 'DAILY', label: 'Daily' }, { value: 'WEEKLY', label: 'Weekly target' }]} />
          {frequency === 'DAILY' ? (
            <fieldset>
              <legend className="mb-1.5 text-xs text-ink-faint">On these days (none = every day)</legend>
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={weekdays.includes(i + 1)} onClick={() => setWeekdays((w) => (w.includes(i + 1) ? w.filter((x) => x !== i + 1) : [...w, i + 1]))} className="h-8 w-10 rounded-lg border border-line text-xs aria-pressed:border-cyan aria-pressed:bg-cyan/15">
                    {d}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <Field label="Times per week" htmlFor="htarget"><Input id="htarget" type="number" min={1} max={7} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
          )}
          <Field label="Reminder (optional)" htmlFor="hrem"><Input id="hrem" type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!name.trim()}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HabitDetail({ habit, onClose }: { habit: HabitDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['habit-stats', habit.id, habit.checkIns.length], queryFn: () => api<{ heatmap: Array<{ date: string; count: number }>; weekly: Array<{ weekStart: string; count: number }>; current: number; best: number; consistency: number; total: number }>(`/habits/${habit.id}/stats`) });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={habit.name}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full" style={{ background: habit.color }} />
        <h2 className="font-display text-lg font-semibold">{habit.name}</h2>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-ink-faint hover:bg-white/5" aria-label="Close"><X size={16} /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-4">
        {!data ? <Spinner /> : (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[['Current', data.current], ['Best', data.best], ['30-day', `${Math.round(data.consistency * 100)}%`], ['Total', data.total]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl border border-line p-2"><div className="font-display text-xl font-semibold">{v}</div><div className="text-[11px] text-ink-faint">{l}</div></div>
              ))}
            </div>
            <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Past year</h3><Heatmap days={data.heatmap} color={habit.color} label={`${habit.name} completion heatmap`} /></div>
            <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Check-ins per week</h3><BarChart label="Check-ins per week" data={data.weekly.map((w) => ({ label: DateTime.fromISO(w.weekStart).toFormat('d LLL'), value: w.count }))} color={habit.color} height={100} /></div>
          </>
        )}
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (!confirm(`Delete “${habit.name}”?`)) return;
            await api(`/habits/${habit.id}`, { method: 'DELETE' }).catch(reportError);
            qc.invalidateQueries({ queryKey: keys.habits });
            onClose();
          }}
        >
          <Trash2 size={14} /> Delete habit
        </Button>
      </div>
    </Sheet>
  );
}
