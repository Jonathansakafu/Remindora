'use client';
import { BarChart, Button, GlassPanel, priorityMeta, ProgressRing, Segmented, Spinner } from '@remindora/ui';
import { Download, Sparkles } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/views/common';
import { API_URL } from '@/lib/config';
import { reportError, useAnalytics, useFeature } from '@/lib/queries';
import { useSession } from '@/lib/session';

export default function AnalyticsPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const to = DateTime.now().setZone(tz).endOf('day');
  const from = to.minus({ days: Number(days) - 1 }).startOf('day');
  const { data, isLoading } = useAnalytics(from.toUTC().toISO()!, to.toUTC().toISO()!);
  const reports = useFeature('reports');

  async function download() {
    try {
      const res = await fetch(`${API_URL}/analytics/report?format=csv&from=${encodeURIComponent(from.toUTC().toISO()!)}&to=${encodeURIComponent(to.toUTC().toISO()!)}`, { headers: { Authorization: `Bearer ${useSession.getState().accessToken}` } });
      if (!res.ok) throw new Error('Report failed');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `remindora-report-${from.toISODate()}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Analytics" subtitle="How your work, focus and habits are trending." actions={reports ? <Button size="sm" onClick={download}><Download size={14} /> Report (CSV)</Button> : undefined}>
        <Segmented label="Range" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      </PageHeader>
      {isLoading || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-4 px-4 md:px-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <GlassPanel className="flex items-center gap-3 p-4"><ProgressRing value={data.completionRate} size={52} label={`${Math.round(data.completionRate * 100)}%`} /><div className="text-xs text-ink-faint">completion<br />rate</div></GlassPanel>
            {[['Completed', data.completed, 'text-success'], ['Overdue now', data.overdue, data.overdue ? 'text-danger' : ''], ['Focus', `${Math.round(data.focusMinutes / 6) / 10}h`, 'text-cyan'], ['Habit consistency', `${Math.round(data.habitConsistency * 100)}%`, 'text-amber']].map(([l, v, c]) => (
              <GlassPanel key={l as string} className="p-4"><div className={`font-display text-2xl font-semibold ${c}`}>{v}</div><div className="mt-0.5 text-xs text-ink-faint">{l}</div></GlassPanel>
            ))}
          </div>
          <GlassPanel className="p-4">
            <div className="mb-3 flex items-center gap-4 text-sm"><h2 className="font-semibold">Completed vs created</h2><span className="flex items-center gap-1.5 text-xs text-ink-faint"><span className="h-2 w-2 rounded-sm bg-cyan" />completed</span><span className="flex items-center gap-1.5 text-xs text-ink-faint"><span className="h-2 w-2 rounded-sm bg-violet" />created</span></div>
            <BarChart label="Tasks completed and created per day" data={data.daily.map((d) => ({ label: DateTime.fromISO(d.date).toFormat(Number(days) > 30 ? 'd/L' : 'd'), value: d.completed, value2: d.created }))} secondary="var(--color-violet)" height={150} />
          </GlassPanel>
          <div className="grid gap-4 md:grid-cols-2">
            <GlassPanel className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Completed by priority</h2>
              <ul className="space-y-2">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const).map((p) => {
                  const v = data.byPriority[p];
                  const max = Math.max(1, ...Object.values(data.byPriority));
                  return (
                    <li key={p} className="flex items-center gap-3 text-sm">
                      <span className="w-16 text-xs" style={{ color: priorityMeta[p].cssVar }}>{priorityMeta[p].label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: priorityMeta[p].cssVar }} /></span>
                      <span className="w-8 text-right tabular-nums text-ink-muted">{v}</span>
                    </li>
                  );
                })}
              </ul>
            </GlassPanel>
            <GlassPanel className="p-4">
              <h2 className="mb-3 text-sm font-semibold">By list</h2>
              <ul className="space-y-2">
                {data.byProject.slice(0, 7).map((p) => (
                  <li key={p.projectId} className="flex items-center gap-3 text-sm">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-success">{p.completed} done</span>
                    <span className="text-xs text-ink-faint">{p.open} open</span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </div>
          <GlassPanel className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Focus minutes</h2>
            <BarChart label="Focus minutes per day" data={data.daily.map((d) => ({ label: DateTime.fromISO(d.date).toFormat('d'), value: d.focusMinutes }))} color="var(--color-success)" height={100} format={(v) => `${v} min`} />
          </GlassPanel>
          {data.premium ? (
            <GlassPanel glow className="grid gap-4 p-4 sm:grid-cols-4">
              <div><div className="text-xs text-ink-faint">Most productive hour</div><div className="font-display text-xl font-semibold">{data.premium.bestHour !== null ? `${String(data.premium.bestHour).padStart(2, '0')}:00` : '—'}</div></div>
              <div><div className="text-xs text-ink-faint">Avg. time to complete</div><div className="font-display text-xl font-semibold">{data.premium.averageCompletionHours !== null ? `${data.premium.averageCompletionHours}h` : '—'}</div></div>
              <div><div className="text-xs text-ink-faint">Completion streak</div><div className="font-display text-xl font-semibold">{data.premium.streakDays} days</div></div>
              <div><div className="text-xs text-ink-faint">Week over week</div><div className="font-display text-xl font-semibold">{data.premium.weekOverWeek === null ? '—' : `${data.premium.weekOverWeek >= 0 ? '+' : ''}${Math.round(data.premium.weekOverWeek * 100)}%`}</div></div>
            </GlassPanel>
          ) : (
            <GlassPanel className="flex flex-wrap items-center gap-3 p-4">
              <Sparkles className="text-amber" size={18} />
              <p className="flex-1 text-sm text-ink-muted">Premium adds your most productive hour, completion-time trends, streaks, and downloadable reports.</p>
              <Link href="/app/settings/billing"><Button size="sm" variant="amber">See Premium</Button></Link>
            </GlassPanel>
          )}
        </div>
      )}
    </div>
  );
}
