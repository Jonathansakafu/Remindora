'use client';
import { Badge, Button, Field, Input, Spinner } from '@remindora/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Plug, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Section } from '@/components/settings/section';
import { api } from '@/lib/api';
import { relative } from '@/lib/dates';
import { reportError, useFeature } from '@/lib/queries';

interface Integration { key: string; name: string; kind: string; description: string; configured: boolean; status: string; lastSyncAt: string | null; lastError: string | null; config: Record<string, unknown> | null }
interface Sub { id: string; name: string; url: string; color: string; lastFetchedAt: string | null; lastError: string | null; events: number }

export default function IntegrationsPage() {
  const entitled = useFeature('integrations');
  const qc = useQueryClient();
  const { data: list } = useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/integrations') });
  const { data: subs = [] } = useQuery({ queryKey: ['calendar-subs'], queryFn: () => api<Sub[]>('/calendar-subscriptions') });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ics, setIcs] = useState({ name: '', url: '' });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['integrations'] });
    qc.invalidateQueries({ queryKey: ['calendar-subs'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };

  async function connect(i: Integration) {
    try {
      const r = await api<{ authorizeUrl?: string; signingSecret?: string }>(`/integrations/${i.key}/connect`, { body: { url: urls[i.key] } });
      if (r.authorizeUrl) window.location.href = r.authorizeUrl;
      else {
        if (r.signingSecret) toast.success('Connected', { description: `Signing secret (shown once): ${r.signingSecret}`, duration: 30000 });
        else toast.success('Connected');
        refresh();
      }
    } catch (e) {
      reportError(e);
    }
  }

  if (!list) return <Spinner />;
  return (
    <>
      {!entitled && <p className="mb-4 flex items-center gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber"><Sparkles size={15} /> Integrations are part of Premium.</p>}
      <Section title="Calendar subscriptions" description="Show any iCal feed (holidays, team calendars, Outlook/Google “secret address”) alongside your tasks.">
        <ul className="mb-4 space-y-2">
          {subs.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-ink-faint">{s.events} events{s.lastFetchedAt ? ` · synced ${relative(s.lastFetchedAt)}` : ''}</span>
              {s.lastError && <Badge tone="danger">{s.lastError}</Badge>}
              <span className="ml-auto flex gap-1">
                {!s.url.startsWith('integration:') && <Button size="icon-sm" variant="ghost" aria-label={`Refresh ${s.name}`} onClick={() => api(`/calendar-subscriptions/${s.id}/refresh`, { method: 'POST' }).then(refresh).catch(reportError)}><RefreshCw size={14} /></Button>}
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => api(`/calendar-subscriptions/${s.id}`, { method: 'DELETE' }).then(refresh).catch(reportError)}><Trash2 size={14} /></Button>
              </span>
            </li>
          ))}
        </ul>
        <form className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]" onSubmit={async (e) => { e.preventDefault(); try { await api('/calendar-subscriptions', { body: ics }); setIcs({ name: '', url: '' }); refresh(); toast.success('Subscribed'); } catch (err) { reportError(err); } }}>
          <Field label="Name" htmlFor="ics-name"><Input id="ics-name" required value={ics.name} onChange={(e) => setIcs({ ...ics, name: e.target.value })} placeholder="Team calendar" disabled={!entitled} /></Field>
          <Field label="iCal URL" htmlFor="ics-url"><Input id="ics-url" required value={ics.url} onChange={(e) => setIcs({ ...ics, url: e.target.value })} placeholder="https://…/basic.ics" disabled={!entitled} /></Field>
          <Button type="submit" className="self-end" disabled={!entitled}><CalendarPlus size={15} /> Subscribe</Button>
        </form>
      </Section>

      <Section title="Connected apps">
        <ul className="space-y-3">
          {list.filter((i) => i.key !== 'ics').map((i) => (
            <li key={i.key} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Plug size={16} className="text-cyan" />
                <span className="font-medium">{i.name}</span>
                {i.status === 'connected' ? <Badge tone="success">connected</Badge> : !i.configured ? <Badge>not configured on this server</Badge> : null}
                {i.lastError && <Badge tone="danger">{i.lastError}</Badge>}
                <span className="ml-auto flex gap-2">
                  {i.status === 'connected' ? (
                    <Button size="sm" variant="ghost" onClick={() => api(`/integrations/${i.key}`, { method: 'DELETE' }).then(refresh).catch(reportError)}>Disconnect</Button>
                  ) : (
                    <Button size="sm" disabled={!i.configured || !entitled || (i.kind === 'webhook' && !urls[i.key])} onClick={() => connect(i)}>Connect</Button>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-faint">{i.description}{i.lastSyncAt ? ` Last sync ${relative(i.lastSyncAt)}.` : ''}</p>
              {i.kind === 'webhook' && i.status !== 'connected' && (
                <Input aria-label={`${i.name} webhook URL`} className="mt-2 h-8 text-xs" placeholder={i.key === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://hooks.zapier.com/…'} value={urls[i.key] ?? ''} onChange={(e) => setUrls({ ...urls, [i.key]: e.target.value })} disabled={!entitled} />
              )}
              {i.key === 'notion' && i.status === 'connected' && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('db') as string; api('/integrations/notion', { method: 'PATCH', body: { databaseId: v } }).then(() => toast.success('Saved')).catch(reportError); }}>
                  <Input name="db" aria-label="Notion database ID" defaultValue={(i.config?.databaseId as string) ?? ''} placeholder="Notion database ID" className="h-8 text-xs" />
                  <Button size="sm" type="submit">Save</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
