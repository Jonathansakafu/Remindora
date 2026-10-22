'use client';
import { Check } from 'lucide-react';
import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { priorityMeta, type PriorityKey } from '../tokens';

export function GlassPanel({ className, strong, glow, ...props }: React.ComponentProps<'div'> & { strong?: boolean; glow?: boolean }) {
  return <div className={cn(strong ? 'glass-strong' : 'glass', 'rounded-[var(--radius-glass)]', glow && 'luminous-border', className)} {...props} />;
}

export function Badge({ className, tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'cyan' | 'violet' | 'amber' | 'danger' | 'success' }) {
  const tones = {
    neutral: 'border-line text-ink-muted',
    cyan: 'border-cyan/30 bg-cyan/10 text-cyan',
    violet: 'border-violet/30 bg-violet/10 text-violet',
    amber: 'border-amber/30 bg-amber/10 text-amber',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    success: 'border-success/30 bg-success/10 text-success',
  };
  return <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium', tones[tone], className)} {...props} />;
}

export function PriorityFlag({ priority, showLabel, className }: { priority: PriorityKey; showLabel?: boolean; className?: string }) {
  const m = priorityMeta[priority];
  if (priority === 'NONE' && !showLabel) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', className)} style={{ color: m.color }}>
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
        <path d="M1 1v10M1 1h7l-1.5 2.5L8 6H1" fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {showLabel ? m.label : m.short}
      <span className="sr-only">{m.label} priority</span>
    </span>
  );
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches || document.documentElement.dataset.motion === 'reduced');
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Task completion checkbox. On completion: quick checkmark draw, a gentle lift,
 * and a restrained particle glow — or a plain fade/scale with reduced motion.
 */
export function TaskCheck({ checked, onChange, priority = 'NONE', label, disabled }: { checked: boolean; onChange: (next: boolean) => void; priority?: PriorityKey; label: string; disabled?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [burst, setBurst] = useState(0);
  const color = priorityMeta[priority].color;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!checked && !reduced) setBurst((b) => b + 1);
        onChange(!checked);
      }}
      className={cn(
        'relative grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full border-[1.5px] transition-all duration-200',
        checked ? 'scale-100 border-transparent' : 'hover:scale-110',
        !reduced && checked && 'animate-[rise_0.3s_ease-out]',
      )}
      style={{ borderColor: checked ? 'transparent' : color, background: checked ? color : `${color}14` }}
    >
      {checked && <Check size={13} strokeWidth={3} className={cn('text-[#06122e]', !reduced && '[stroke-dasharray:24] [animation:draw_0.25s_ease-out]')} />}
      {burst > 0 && !reduced && (
        <span key={burst} aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full"
              style={{
                background: color,
                boxShadow: `0 0 6px ${color}`,
                animation: `particle 0.55s ease-out forwards`,
                ['--dx' as string]: `${Math.cos((i / 8) * Math.PI * 2) * 16}px`,
                ['--dy' as string]: `${Math.sin((i / 8) * Math.PI * 2) * 16}px`,
              }}
            />
          ))}
          <style>{`@keyframes particle{from{transform:translate(-50%,-50%) scale(1);opacity:.95}to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(.2);opacity:0}}@keyframes draw{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}`}</style>
        </span>
      )}
    </button>
  );
}

export function Avatar({ name, src, size = 28, className }: { name: string | null | undefined; src?: string | null; size?: number; className?: string }) {
  const initials = (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const hue = [...(name ?? '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className={cn('rounded-full object-cover ring-1 ring-line-strong', className)} />
  ) : (
    <span aria-hidden className={cn('inline-grid place-items-center rounded-full font-semibold text-[#06122e] ring-1 ring-white/20', className)} style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 85% 78%)` }}>
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-bg-elevated px-1 font-sans text-[10px] font-medium text-ink-muted">{children}</kbd>;
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn('animate-spin text-cyan', className)} role="status" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-16 text-center">
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface/60 text-cyan">{icon}</div>}
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1.5 text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ProgressRing({ value, size = 44, stroke = 4, color = '#60E9FF', label }: { value: number; size?: number; stroke?: number; color?: string; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" className="text-line" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset .5s ease', filter: `drop-shadow(0 0 4px ${color}66)` }} />
      </svg>
      {label !== undefined && <span className="absolute text-[11px] font-semibold text-ink">{label}</span>}
    </div>
  );
}

/** GitHub-style completion heatmap (weeks × weekdays). */
export function Heatmap({ days, color = '#60E9FF', label }: { days: Array<{ date: string; count: number }>; color?: string; label: string }) {
  const weeks: Array<typeof days> = [];
  const firstDow = days.length ? (new Date(days[0]!.date + 'T00:00:00Z').getUTCDay() + 6) % 7 : 0;
  const padded = [...Array.from({ length: firstDow }, () => null), ...days];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7) as typeof days);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div role="img" aria-label={label} className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((d, di) =>
              d ? (
                <span key={di} title={`${d.date}: ${d.count}`} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: d.count ? color : 'rgb(168 239 255 / 0.07)', opacity: d.count ? 0.35 + 0.65 * (d.count / max) : 1 }} />
              ) : (
                <span key={di} className="h-[11px] w-[11px]" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Minimal accessible bar chart; values are also exposed as a table for screen readers. */
export function BarChart({ data, height = 140, color = '#60E9FF', secondary, label, format = (v: number) => String(v) }: { data: Array<{ label: string; value: number; value2?: number }>; height?: number; color?: string; secondary?: string; label: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)));
  const id = useId();
  return (
    <figure aria-labelledby={id}>
      <figcaption id={id} className="sr-only">{label}</figcaption>
      <div className="flex items-end gap-1" style={{ height }} aria-hidden>
        {data.map((d, i) => (
          <div key={i} className="group relative flex flex-1 items-end justify-center gap-[2px]" style={{ height: '100%' }}>
            <div className="w-full max-w-4 rounded-t-[4px] transition-[height] duration-500" style={{ height: `${(d.value / max) * 100}%`, background: `linear-gradient(180deg, ${color}, ${color}55)`, minHeight: d.value ? 3 : 0 }} />
            {secondary && d.value2 !== undefined && <div className="w-full max-w-4 rounded-t-[4px]" style={{ height: `${(d.value2 / max) * 100}%`, background: `${secondary}88`, minHeight: d.value2 ? 3 : 0 }} />}
            <span className="pointer-events-none absolute -top-6 hidden whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[10px] text-ink group-hover:block">{d.label}: {format(d.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 text-[10px] text-ink-faint" aria-hidden>
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center">{data.length <= 14 || i % Math.ceil(data.length / 10) === 0 ? d.label : ''}</span>
        ))}
      </div>
      <table className="sr-only">
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-line bg-bg-elevated/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40', value === o.value && 'bg-surface-high text-ink shadow-[0_0_0_1px_rgb(96_233_255/0.25)]')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
