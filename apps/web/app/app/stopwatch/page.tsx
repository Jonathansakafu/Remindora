'use client';
import { Button, cn, GlassPanel, Segmented } from '@remindora/ui';
import { Flag, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAlarm } from '@/lib/alarm';

/**
 * Stopwatch with laps, and a countdown timer that rings the alarm when it ends.
 * State is timestamp-based and kept in localStorage, so both keep running across
 * page changes and reloads.
 */

type Watch = { startedAt: number | null; elapsed: number; laps: number[] };
type Countdown = { endsAt: number | null; remaining: number; total: number };

const WATCH_KEY = 'rmd.stopwatch';
const TIMER_KEY = 'rmd.timer';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function fmt(ms: number, centis = true) {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  const base = `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return centis ? `${base}.${String(cs).padStart(2, '0')}` : base;
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      set((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

function Stopwatch() {
  const [w, setW] = useState<Watch>({ startedAt: null, elapsed: 0, laps: [] });
  useEffect(() => setW(load(WATCH_KEY, { startedAt: null, elapsed: 0, laps: [] })), []);
  const update = (next: Watch) => {
    setW(next);
    save(WATCH_KEY, next);
  };
  const running = w.startedAt !== null;
  useTick(running);
  const now = w.elapsed + (running ? Date.now() - w.startedAt! : 0);

  return (
    <GlassPanel strong className="flex flex-col items-center p-8">
      <p className="font-display text-6xl font-semibold tabular-nums tracking-tight md:text-7xl" role="timer" aria-live="off">
        {fmt(now)}
      </p>
      <div className="mt-8 flex w-full max-w-sm gap-3">
        {running ? (
          <Button variant="secondary" size="lg" className="h-14 flex-1 text-base" onClick={() => update({ ...w, laps: [now, ...w.laps] })}>
            <Flag size={18} /> Lap
          </Button>
        ) : (
          <Button variant="secondary" size="lg" className="h-14 flex-1 text-base" onClick={() => update({ startedAt: null, elapsed: 0, laps: [] })} disabled={now === 0}>
            <RotateCcw size={18} /> Reset
          </Button>
        )}
        <Button
          variant={running ? 'amber' : 'primary'}
          size="lg"
          className="h-14 flex-1 text-base"
          onClick={() => update(running ? { ...w, startedAt: null, elapsed: now } : { ...w, startedAt: Date.now() })}
        >
          {running ? (<><Pause size={18} /> Pause</>) : (<><Play size={18} /> {now ? 'Resume' : 'Start'}</>)}
        </Button>
      </div>
      {w.laps.length > 0 && (
        <ol className="mt-8 w-full max-w-sm divide-y divide-line text-sm">
          {w.laps.map((t, i) => {
            const n = w.laps.length - i;
            const split = t - (w.laps[i + 1] ?? 0);
            return (
              <li key={n} className="flex justify-between py-2 tabular-nums">
                <span className="text-ink-muted">Lap {n}</span>
                <span>{fmt(split)}</span>
                <span className="text-ink-faint">{fmt(t)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </GlassPanel>
  );
}

const PRESETS = [1, 5, 10, 15, 30, 60];

function Timer() {
  const ring = useAlarm((s) => s.ring);
  const [t, setT] = useState<Countdown>({ endsAt: null, remaining: 5 * 60_000, total: 5 * 60_000 });
  const [minutes, setMinutes] = useState('5');
  useEffect(() => setT(load(TIMER_KEY, { endsAt: null, remaining: 5 * 60_000, total: 5 * 60_000 })), []);
  const update = (next: Countdown) => {
    setT(next);
    save(TIMER_KEY, next);
  };
  const running = t.endsAt !== null;
  useTick(running);
  const left = running ? t.endsAt! - Date.now() : t.remaining;

  useEffect(() => {
    if (running && left <= 0) {
      update({ endsAt: null, remaining: t.total, total: t.total });
      ring({ notificationId: `timer-${Date.now()}`, taskId: null, title: 'Time’s up!', body: `Your ${fmt(t.total, false)} timer has finished.`, test: true });
    }
  });

  const set = (m: number) => {
    setMinutes(String(m));
    update({ endsAt: null, remaining: m * 60_000, total: m * 60_000 });
  };

  return (
    <GlassPanel strong className="flex flex-col items-center p-8">
      <p className={cn('font-display text-6xl font-semibold tabular-nums tracking-tight md:text-7xl', running && left < 10_000 && 'text-amber')} role="timer">
        {fmt(left, false)}
      </p>
      {!running && (
        <div className="mt-6 w-full max-w-sm">
          <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Quick times">
            {PRESETS.map((m) => (
              <button key={m} type="button" onClick={() => set(m)} className={cn('glass h-10 rounded-xl px-3 text-sm font-medium', t.total === m * 60_000 && 'border-cyan text-cyan')}>
                {m < 60 ? `${m} min` : '1 hour'}
              </button>
            ))}
          </div>
          <label className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-muted">
            Custom
            <input
              type="number"
              min={1}
              max={600}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                const m = Number(e.target.value);
                if (m >= 1 && m <= 600) update({ endsAt: null, remaining: m * 60_000, total: m * 60_000 });
              }}
              className="h-10 w-20 rounded-xl border border-line bg-bg-elevated px-2 text-center text-ink"
              aria-label="Minutes"
            />
            minutes
          </label>
        </div>
      )}
      <div className="mt-8 flex w-full max-w-sm gap-3">
        <Button variant="secondary" size="lg" className="h-14 flex-1 text-base" onClick={() => update({ endsAt: null, remaining: t.total, total: t.total })}>
          <RotateCcw size={18} /> Reset
        </Button>
        <Button
          variant={running ? 'amber' : 'primary'}
          size="lg"
          className="h-14 flex-1 text-base"
          onClick={() => update(running ? { ...t, endsAt: null, remaining: left } : { ...t, endsAt: Date.now() + t.remaining })}
          disabled={!running && t.remaining <= 0}
        >
          {running ? (<><Pause size={18} /> Pause</>) : (<><Play size={18} /> Start</>)}
        </Button>
      </div>
      <p className="mt-6 text-xs text-ink-faint">The alarm rings when time is up. Keep this app open (or in the tray on desktop).</p>
    </GlassPanel>
  );
}

export default function StopwatchPage() {
  const [mode, setMode] = useState<'stopwatch' | 'timer'>('stopwatch');
  return (
    <div className="mx-auto px-4 pt-5 md:px-8 md:pt-7 max-w-2xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{mode === 'stopwatch' ? 'Stopwatch' : 'Timer'}</h1>
          <p className="mt-1 text-ink-muted">{mode === 'stopwatch' ? 'Time anything, with laps.' : 'Count down and get an alarm when it’s done.'}</p>
        </div>
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'stopwatch', label: 'Stopwatch' }, { value: 'timer', label: 'Timer' }]} />
      </div>
      {mode === 'stopwatch' ? <Stopwatch /> : <Timer />}
    </div>
  );
}
