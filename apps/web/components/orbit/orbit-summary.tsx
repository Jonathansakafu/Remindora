'use client';
import { cn, GlassPanel, ProgressRing, usePrefersReducedMotion } from '@remindora/ui';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createRef, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useHabits, useTasks } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

const OrbitScene = dynamic(() => import('./orbit-scene'), { ssr: false, loading: () => null });

export interface OrbitMetric {
  label: string;
  display: string;
  value: number;
  color: string;
  href: string;
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Optional 3D orbital dashboard: the translucent sphere is your day (fills as you
 * complete tasks); orbiting nodes are Today, Focus, Habits and Progress. Falls back
 * to a static 2D summary with reduced motion, without WebGL, or when disabled.
 */
export function OrbitSummary({ tall }: { tall?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const show3d = useUi((s) => s.show3d);
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const router = useRouter();
  const { data: today = [] } = useTasks({ view: 'today', includeCompleted: true });
  const { data: done = [] } = useTasks({ view: 'completed' });
  const { data: habits = [] } = useHabits();
  const { data: focus } = useQuery({ queryKey: ['focus-stats'], queryFn: () => api<{ todayMinutes: number }>('/focus/stats') });
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [webgl, setWebgl] = useState(false);

  useEffect(() => setWebgl(supportsWebGL()), []);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.05 });
    io.observe(ref.current);
    const vis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const todayKey = DateTime.now().setZone(tz).toISODate();
  const completedToday = done.filter((t) => t.completedAt && DateTime.fromISO(t.completedAt).setZone(tz).toISODate() === todayKey).length;
  const open = today.filter((t) => !t.completedAt).length;
  const progress = completedToday + open ? completedToday / (completedToday + open) : 0;
  const habitsDone = habits.filter((h) => h.checkIns.includes(todayKey!)).length;
  const metrics: OrbitMetric[] = [
    { label: 'Today', display: `${open} open`, value: Math.min(1, open / 10), color: 'var(--color-cyan)', href: '/app/today' },
    { label: 'Focus', display: `${focus?.todayMinutes ?? 0} min`, value: Math.min(1, (focus?.todayMinutes ?? 0) / 120), color: 'var(--color-success)', href: '/app/focus' },
    { label: 'Habits', display: `${habitsDone}/${habits.length}`, value: habits.length ? habitsDone / habits.length : 0, color: 'var(--color-amber)', href: '/app/habits' },
    { label: 'Progress', display: `${Math.round(progress * 100)}% done`, value: progress, color: 'var(--color-violet)', href: '/app/analytics' },
  ];
  const use3d = show3d && !reduced && webgl;
  const labelRefs = useMemo(() => [0, 1, 2, 3].map(() => createRef<HTMLButtonElement>()), []);

  return (
    <GlassPanel glow className={cn('relative overflow-hidden', tall ? 'h-[60vh] min-h-96' : 'h-56')} ref={ref}>
      {use3d ? (
        <>
          <div className="absolute inset-0 animate-fade" aria-hidden>
            <OrbitScene metrics={metrics} progress={progress} paused={!visible} labels={labelRefs} />
          </div>
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {metrics.map((m, i) => (
              <button
                key={m.label}
                ref={labelRefs[i]}
                type="button"
                onClick={() => router.push(m.href)}
                style={{ opacity: 0 }}
                className="glass-strong pointer-events-auto absolute left-0 top-0 whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] leading-tight text-ink will-change-transform hover:border-line-strong"
              >
                <span className="font-semibold" style={{ color: m.color }}>{m.label}</span> <span className="text-ink-muted">{m.display}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className={cn('relative flex h-full flex-col justify-between p-4', use3d && 'pointer-events-none')}>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-faint">Your day</p>
          <p className="font-display text-2xl font-semibold">{Math.round(progress * 100)}% complete</p>
        </div>
        {/* Accessible summary (also the reduced-motion / no-WebGL fallback). */}
        <ul className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', use3d && 'hidden')}>
          {metrics.map((m) => (
            <li key={m.label}>
              <button type="button" onClick={() => router.push(m.href)} className="pointer-events-auto flex w-full items-center gap-2.5 rounded-xl border border-line bg-bg-elevated/60 p-2.5 text-left transition-transform hover:scale-[1.02]">
                <ProgressRing value={m.value} size={34} stroke={3.5} color={m.color} />
                <span>
                  <span className="block text-xs font-semibold" style={{ color: m.color }}>{m.label}</span>
                  <span className="block text-xs text-ink-muted">{m.display}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}
