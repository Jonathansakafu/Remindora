'use client';
import { Button, cn, GlassPanel, Input, Spinner } from '@remindora/ui';
import type { HabitDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ListChecks, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { api } from '@/lib/api';
import { keys, reportError, useHabits } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Daily checklist notebook. Items are stored as daily habits, so ticks are kept per
 * day: every morning the list starts fresh, and yesterday's ticks stay in history.
 */
export default function ChecklistPage() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useHabits();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const today = DateTime.now().setZone(tz);
  const date = today.toISODate()!;
  const list = items.filter((h) => !h.archived);
  const done = list.filter((h) => h.checkIns.includes(date)).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    setAdding(true);
    try {
      const created = await api<HabitDTO>('/habits', { body: { name, frequency: 'DAILY' } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => [...(prev ?? []), created]);
      setText('');
    } catch (err) {
      reportError(err, 'Couldn’t add the item');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(h: HabitDTO, next: boolean) {
    qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.map((x) => (x.id === h.id ? { ...x, checkIns: next ? [...x.checkIns, date] : x.checkIns.filter((d) => d !== date) } : x)));
    try {
      const updated = await api<HabitDTO>(`/habits/${h.id}/check-in`, { body: { date, done: next } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.map((x) => (x.id === h.id ? updated : x)));
    } catch (err) {
      reportError(err);
      qc.invalidateQueries({ queryKey: keys.habits });
    }
  }

  async function remove(h: HabitDTO) {
    qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.filter((x) => x.id !== h.id));
    try {
      await api(`/habits/${h.id}`, { method: 'DELETE' });
    } catch (err) {
      reportError(err);
      qc.invalidateQueries({ queryKey: keys.habits });
    }
  }

  return (
    <div className="mx-auto px-4 pb-24 pt-5 md:px-8 md:pt-7 max-w-2xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Daily checklist</h1>
      <p className="mt-1 text-ink-muted">
        {today.toFormat('cccc d LLLL')} · Your list starts fresh every morning.
      </p>

      {list.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {done} of {list.length} done
            </span>
            {done === list.length && <span className="font-medium text-success">All done for today 🎉</span>}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={done} aria-label="Checklist progress">
            <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${(done / list.length) * 100}%` }} />
          </div>
        </div>
      )}

      <form onSubmit={add} className="mt-6 flex gap-2">
        <label htmlFor="cl-new" className="sr-only">
          New checklist item
        </label>
        <Input id="cl-new" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="Add an item, e.g. Drink water, Exercise, Read 10 pages" className="h-12 flex-1 text-base" />
        <Button type="submit" variant="primary" size="lg" disabled={adding || !text.trim()} aria-label="Add item">
          {adding ? <Spinner className="text-on-accent" /> : <Plus size={20} />}
        </Button>
      </form>

      {isLoading ? (
        <div className="mt-6">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <GlassPanel className="mt-6 flex flex-col items-center p-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
            <ListChecks size={30} />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">Your checklist is empty</h2>
          <p className="mt-1 max-w-sm text-ink-muted">Add the things you want to do every day. Tick them off as you go.</p>
        </GlassPanel>
      ) : (
        <ul className="mt-5 space-y-2">
          {list.map((h) => {
            const checked = h.checkIns.includes(date);
            return (
              <li key={h.id}>
                <GlassPanel className="flex items-center gap-3 p-2 pr-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(h, !checked)}
                    className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-2 text-left"
                  >
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 transition-colors', checked ? 'border-success bg-success text-on-accent' : 'border-line-strong')}>
                      {checked && <Check size={18} strokeWidth={3} />}
                    </span>
                    <span className={cn('text-base', checked && 'text-ink-faint line-through')}>{h.name}</span>
                    {h.currentStreak > 1 && <span className="ml-auto text-xs text-ink-faint">{h.currentStreak}-day streak</span>}
                  </button>
                  <Button size="icon" variant="ghost" aria-label={`Remove “${h.name}”`} onClick={() => remove(h)}>
                    <Trash2 size={16} />
                  </Button>
                </GlassPanel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
