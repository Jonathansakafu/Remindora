'use client';
import { BarChart, Button, Field, GlassPanel, Input, ProgressRing, Segmented, Select, Switch } from '@remindora/ui';
import type { FocusSessionDTO } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, SkipForward, Volume2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/views/common';
import { api } from '@/lib/api';
import { phaseMinutes, playAmbient, useFocus, type Phase } from '@/lib/focus-store';
import { nativeNotify } from '@/lib/platform';
import { reportError, useTasks } from '@/lib/queries';

const PHASE_LABEL: Record<Phase, string> = { FOCUS: 'Focus', SHORT_BREAK: 'Short break', LONG_BREAK: 'Long break' };
const PHASE_COLOR: Record<Phase, string> = { FOCUS: '#60E9FF', SHORT_BREAK: '#7CF3B0', LONG_BREAK: '#A58CFF' };

export default function FocusPage() {
  const f = useFocus();
  const qc = useQueryClient();
  const [, tick] = useState(0);
  const { data: today = [] } = useTasks({ view: 'today' });
  const { data: stats } = useQuery({ queryKey: ['focus-stats'], queryFn: () => api<{ todayMinutes: number; weekMinutes: number; sessionsToday: number; days: Array<{ date: string; minutes: number }>; topTasks: Array<{ taskId: string; title: string; minutes: number }> }>('/focus/stats') });
  const { data: history = [] } = useQuery({ queryKey: ['focus-history'], queryFn: () => api<FocusSessionDTO[]>('/focus') });

  const total = phaseMinutes(f, f.phase) * 60_000;
  const remaining = f.running && f.endsAt ? Math.max(0, f.endsAt - Date.now()) : f.remainingMs;
  const mm = String(Math.floor(remaining / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0');

  useEffect(() => {
    if (!f.running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [f.running]);

  useEffect(() => {
    playAmbient(f.running && f.phase === 'FOCUS' ? f.sound : 'off');
    return () => playAmbient('off');
  }, [f.running, f.phase, f.sound]);

  useEffect(() => {
    if (f.running && remaining <= 0) void finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, f.running]);

  async function start() {
    try {
      const s = await api<FocusSessionDTO>('/focus/start', { body: { kind: f.phase, plannedMinutes: phaseMinutes(f, f.phase), taskId: f.phase === 'FOCUS' ? f.taskId : null } });
      f.set({ running: true, endsAt: Date.now() + f.remainingMs, sessionId: s.id });
    } catch (e) {
      reportError(e);
    }
  }

  function pause() {
    f.set({ running: false, remainingMs: remaining, endsAt: null });
  }

  async function finish(completed: boolean) {
    const { sessionId, phase, cycle, cyclesBeforeLong } = useFocus.getState();
    const elapsed = Math.round((total - remaining) / 1000);
    if (sessionId) await api(`/focus/${sessionId}/finish`, { body: { completed, actualSeconds: completed ? phaseMinutes(f, phase) * 60 : elapsed } }).catch(() => undefined);
    let next: Phase = 'FOCUS';
    let nextCycle = cycle;
    if (phase === 'FOCUS') next = cycle % cyclesBeforeLong === 0 ? 'LONG_BREAK' : 'SHORT_BREAK';
    else nextCycle = phase === 'LONG_BREAK' ? 1 : cycle + 1;
    f.set({ phase: next, cycle: nextCycle, running: false, endsAt: null, sessionId: null, remainingMs: phaseMinutes(f, next) * 60_000 });
    if (completed) void nativeNotify({ title: phase === 'FOCUS' ? 'Focus session complete' : 'Break over', body: phase === 'FOCUS' ? 'Time for a break.' : 'Ready for the next focus block?', tag: 'focus' });
    qc.invalidateQueries({ queryKey: ['focus-stats'] });
    qc.invalidateQueries({ queryKey: ['focus-history'] });
    if (completed && phase === 'FOCUS' && useFocus.getState().autoStartBreaks) setTimeout(() => void start(), 400);
  }

  const color = PHASE_COLOR[f.phase];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Focus" subtitle="Pomodoro sessions linked to your tasks." />
      <div className="grid gap-4 px-4 md:grid-cols-[1.2fr_1fr] md:px-8">
        <GlassPanel glow className="flex flex-col items-center p-6">
          <Segmented label="Phase" value={f.phase} onChange={(p) => !f.running && f.set({ phase: p, remainingMs: phaseMinutes(f, p) * 60_000 })} options={(['FOCUS', 'SHORT_BREAK', 'LONG_BREAK'] as Phase[]).map((p) => ({ value: p, label: PHASE_LABEL[p], disabled: f.running }))} />
          <div className="relative my-6">
            <ProgressRing value={1 - remaining / total} size={240} stroke={10} color={color} />
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-display text-6xl font-semibold tabular-nums" role="timer" aria-live="off" aria-label={`${mm} minutes ${ss} seconds remaining`}>
                  {mm}:{ss}
                </div>
                <div className="mt-1 text-sm text-ink-muted">{PHASE_LABEL[f.phase]} · cycle {f.cycle}/{f.cyclesBeforeLong}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="Reset" onClick={() => f.set({ running: false, endsAt: null, remainingMs: total, sessionId: null })}>
              <RotateCcw size={18} />
            </Button>
            {f.running ? (
              <Button size="lg" variant="secondary" onClick={pause} className="w-36"><Pause size={18} /> Pause</Button>
            ) : (
              <Button size="lg" variant="primary" onClick={() => (f.sessionId ? f.set({ running: true, endsAt: Date.now() + f.remainingMs }) : start())} className="w-36"><Play size={18} /> {f.sessionId ? 'Resume' : 'Start'}</Button>
            )}
            <Button size="icon" variant="ghost" aria-label="Skip to next phase" onClick={() => finish(false)}>
              <SkipForward size={18} />
            </Button>
          </div>
          <div className="mt-6 w-full max-w-sm space-y-3">
            <Field label="Working on" htmlFor="focus-task">
              <Select id="focus-task" value={f.taskId ?? ''} onChange={(e) => f.configure({ taskId: e.target.value || null })} disabled={f.running}>
                <option value="">No linked task</option>
                {today.filter((t) => !t.completedAt).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </Field>
            <Field label="Ambient sound" htmlFor="focus-sound">
              <div className="flex items-center gap-2">
                <Volume2 size={16} className="text-ink-faint" />
                <Select id="focus-sound" value={f.sound} onChange={(e) => f.configure({ sound: e.target.value as 'off' })}>
                  <option value="off">Off</option>
                  <option value="rain">Soft rain</option>
                  <option value="brown">Brown noise</option>
                  <option value="white">White noise</option>
                </Select>
              </div>
            </Field>
          </div>
        </GlassPanel>

        <div className="space-y-4">
          <GlassPanel className="grid grid-cols-3 gap-2 p-4 text-center">
            <div><div className="font-display text-2xl font-semibold text-cyan">{stats?.todayMinutes ?? 0}</div><div className="text-xs text-ink-faint">min today</div></div>
            <div><div className="font-display text-2xl font-semibold">{stats?.sessionsToday ?? 0}</div><div className="text-xs text-ink-faint">sessions</div></div>
            <div><div className="font-display text-2xl font-semibold text-violet">{Math.round((stats?.weekMinutes ?? 0) / 6) / 10}h</div><div className="text-xs text-ink-faint">this week</div></div>
          </GlassPanel>
          <GlassPanel className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Last 30 days</h2>
            <BarChart label="Focus minutes per day, last 30 days" data={(stats?.days ?? []).map((d) => ({ label: DateTime.fromISO(d.date).toFormat('d'), value: d.minutes }))} height={110} format={(v) => `${v} min`} />
          </GlassPanel>
          <GlassPanel className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Settings</h2>
            <div className="grid grid-cols-2 gap-3">
              {([['focusMinutes', 'Focus (min)'], ['shortBreak', 'Short break'], ['longBreak', 'Long break'], ['cyclesBeforeLong', 'Cycles before long']] as const).map(([k, label]) => (
                <Field key={k} label={label} htmlFor={k}>
                  <Input id={k} type="number" min={1} max={k === 'cyclesBeforeLong' ? 10 : 180} value={f[k]} disabled={f.running} onChange={(e) => f.configure({ [k]: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between text-sm">Auto-start breaks <Switch checked={f.autoStartBreaks} onCheckedChange={(v) => f.configure({ autoStartBreaks: v })} /></label>
          </GlassPanel>
          <GlassPanel className="p-4">
            <h2 className="mb-2 text-sm font-semibold">History</h2>
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {history.slice(0, 20).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-ink-muted">
                  <span>{DateTime.fromISO(s.startedAt).toFormat('ccc d LLL, HH:mm')}</span>
                  <span className={s.completed ? 'text-success' : 'text-ink-faint'}>{Math.round(s.actualSeconds / 60)} min{s.kind !== 'FOCUS' ? ' break' : ''}</span>
                </li>
              ))}
              {!history.length && <li className="text-ink-faint">No sessions yet.</li>}
            </ul>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
