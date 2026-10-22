'use client';
import { Badge, Button, cn, GlassPanel, Segmented, Spinner } from '@remindora/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Section } from '@/components/settings/section';
import { api } from '@/lib/api';
import { keys, reportError, useEntitlements } from '@/lib/queries';

interface Catalog {
  provider: string;
  plans: Array<{ plan: 'FREE' | 'PREMIUM' | 'TEAM'; price: { month: number; year: number; currency: string; perSeat?: boolean } | null; limits: Record<string, number>; features: Record<string, boolean> }>;
}

const LIMIT_ROWS: Array<[string, string]> = [
  ['lists.max', 'Lists'],
  ['tasksPerList.max', 'Tasks per list'],
  ['checklistItemsPerTask.max', 'Checklist items per task'],
  ['remindersPerTask.max', 'Reminders per task'],
  ['attachmentsPerDay.max', 'Attachments per day'],
  ['members.max', 'Collaborators per workspace'],
  ['habits.max', 'Habits'],
  ['countdowns.max', 'Countdowns'],
];
const FEATURE_ROWS: Array<[string, string]> = [
  ['view.timeline', 'Timeline / Gantt view'],
  ['view.calendarMulti', 'Day, 3-day, multi-week & year calendars'],
  ['view.matrixAdvanced', 'Advanced Eisenhower Matrix'],
  ['task.duration', 'Duration & time blocking'],
  ['reminders.email', 'Email reminders'],
  ['reminders.constant', 'Constant reminders'],
  ['reminders.checklist', 'Checklist-item reminders'],
  ['templates.custom', 'Custom templates'],
  ['history.full', 'Full activity history'],
  ['filters.advanced', 'Advanced filters'],
  ['stats.premium', 'Premium analytics & reports'],
  ['integrations', 'Integrations & calendar subscriptions'],
  ['ai', 'AI planning assistant'],
];

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: ent } = useEntitlements();
  const { data: catalog } = useQuery({ queryKey: ['plans'], queryFn: () => api<Catalog>('/billing/plans', { auth: false }) });
  const { data: usage } = useQuery({ queryKey: ['usage'], queryFn: () => api<Record<string, number>>('/me/usage') });
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const handled = useRef(false);

  // Dev billing provider: the "checkout" returns here and activates instantly.
  useEffect(() => {
    const plan = params.get('devCheckout');
    if (handled.current) return;
    if (plan) {
      handled.current = true;
      api('/billing/dev/activate', { body: { plan, interval: params.get('interval') ?? 'month' } })
        .then(() => toast.success(`${plan.charAt(0) + plan.slice(1).toLowerCase()} activated`))
        .catch(reportError)
        .finally(() => {
          qc.invalidateQueries({ queryKey: keys.entitlements });
          router.replace('/app/settings/billing');
        });
    } else if (params.get('status') === 'success') {
      handled.current = true;
      toast.success('Thanks! Your plan will update in a moment.');
      qc.invalidateQueries({ queryKey: keys.entitlements });
    }
  }, [params, qc, router]);

  async function checkout(plan: 'PREMIUM' | 'TEAM') {
    try {
      const { url } = await api<{ url: string }>('/billing/checkout', { body: { plan, interval } });
      window.location.href = url;
    } catch (e) {
      reportError(e);
    }
  }

  if (!catalog || !ent) return <Spinner />;
  return (
    <>
      <Section
        title={`You’re on ${ent.plan.charAt(0) + ent.plan.slice(1).toLowerCase()}`}
        description={ent.currentPeriodEnd ? `Renews or ends ${new Date(ent.currentPeriodEnd).toLocaleDateString()}.` : 'Limits and features are applied by the server and can change without an app update.'}
        actions={ent.plan !== 'FREE' ? <Button size="sm" onClick={() => api<{ url: string }>('/billing/portal', { method: 'POST' }).then((r) => (window.location.href = r.url)).catch(reportError)}>Manage billing</Button> : undefined}
      >
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {LIMIT_ROWS.filter(([k]) => usage && k in usage).map(([k, label]) => {
            const used = usage![k] ?? 0;
            const limit = ent.limits[k] ?? 0;
            return (
              <li key={k}>
                <div className="flex justify-between text-xs"><span className="text-ink-muted">{label}</span><span className="tabular-nums text-ink-faint">{used} / {limit}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5"><div className={cn('h-full rounded-full', used >= limit ? 'bg-danger' : 'bg-cyan')} style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} /></div>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Plans</h2>
        <Segmented label="Billing interval" value={interval} onChange={setInterval} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly · save 40%' }]} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {catalog.plans.map((p) => {
          const current = p.plan === ent.plan;
          return (
            <GlassPanel key={p.plan} glow={p.plan === 'PREMIUM'} className="flex flex-col p-5">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-semibold">{p.plan.charAt(0) + p.plan.slice(1).toLowerCase()}</h3>
                {current && <Badge tone="cyan">current</Badge>}
                {p.plan === 'TEAM' && <Badge tone="violet">team-ready</Badge>}
              </div>
              <p className="mt-2 font-display text-3xl font-semibold">
                {p.price ? `$${interval === 'year' ? (p.price.year / 12).toFixed(2) : p.price.month}` : '$0'}
                <span className="text-sm font-normal text-ink-faint"> /mo{p.price?.perSeat ? ' per seat' : ''}</span>
              </p>
              {p.price && interval === 'year' && <p className="text-xs text-ink-faint">billed ${p.price.year} yearly</p>}
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {LIMIT_ROWS.map(([k, label]) => <li key={k} className="flex justify-between gap-2 text-ink-muted"><span>{label}</span><span className="tabular-nums text-ink">{p.limits[k]}</span></li>)}
                {FEATURE_ROWS.filter(([k]) => p.features[k]).map(([k, label]) => <li key={k} className="flex items-center gap-2"><Check size={14} className="text-success" /> {label}</li>)}
              </ul>
              {p.plan !== 'FREE' && !current && (
                <Button className="mt-5" variant={p.plan === 'PREMIUM' ? 'amber' : 'secondary'} onClick={() => checkout(p.plan as 'PREMIUM')}>
                  <Sparkles size={15} /> Upgrade to {p.plan.charAt(0) + p.plan.slice(1).toLowerCase()}
                </Button>
              )}
              {p.plan === 'FREE' && ent.plan !== 'FREE' && catalog.provider === 'dev' && (
                <Button className="mt-5" variant="ghost" onClick={() => api('/billing/dev/activate', { body: { plan: 'FREE' } }).then(() => qc.invalidateQueries({ queryKey: keys.entitlements })).catch(reportError)}>Switch to Free (dev)</Button>
              )}
            </GlassPanel>
          );
        })}
      </div>
      {catalog.provider === 'dev' && <p className="mt-3 text-xs text-amber">Development billing provider: upgrades activate instantly without payment.</p>}
    </>
  );
}

export default function BillingPage() {
  return <Suspense><Inner /></Suspense>;
}
