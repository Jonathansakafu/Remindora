'use client';
import { Button, Input, Segmented, Select, Spinner, Switch } from '@remindora/ui';
import type { NotificationPreferenceDTO } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Section, SettingRow } from '@/components/settings/section';
import { api } from '@/lib/api';
import { enableDeviceNotifications } from '@/lib/device-notifications';
import { relative } from '@/lib/dates';
import { isTauri } from '@/lib/platform';
import { keys, reportError, useFeature, useMe, usePrefs, useProjects } from '@/lib/queries';


export default function NotificationSettings() {
  const { data: prefs } = usePrefs();
  const { data: me } = useMe();
  const { data: projects = [] } = useProjects();
  const qc = useQueryClient();
  const emailEntitled = useFeature('reminders.email');
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const { data: events = [] } = useQuery({ queryKey: ['notification-events'], queryFn: () => api<Array<{ id: string; type: string; channel: string | null; createdAt: string }>>('/notifications/events', { query: { limit: 30 } }) });

  async function save(patch: Record<string, unknown>) {
    qc.setQueryData<NotificationPreferenceDTO>(keys.prefs, (p) => (p ? ({ ...p, ...patch, channels: { ...p.channels, ...((patch.channels as object) ?? {}) } } as NotificationPreferenceDTO) : p));
    try {
      qc.setQueryData(keys.prefs, await api<NotificationPreferenceDTO>('/notifications/preferences', { method: 'PATCH', body: patch }));
    } catch (e) {
      reportError(e);
      qc.invalidateQueries({ queryKey: keys.prefs });
    }
  }

  async function enableBrowser() {
    try {
      const result = await enableDeviceNotifications();
      if (result !== 'unsupported') setPermission(result === 'granted' ? 'granted' : result);
      if (result === 'granted') toast.success(isTauri() ? 'Desktop notifications enabled' : 'Notifications enabled for this browser');
      else if (result === 'denied') toast('Notifications are blocked in your browser or system settings.');
      else if (result === 'unsupported') toast('This browser doesn’t support notifications.');
    } catch (e) {
      reportError(e, 'Couldn’t register for push');
    }
  }

  if (!prefs) return <Spinner />;
  const minutes = (v: number) => (v >= 60 && v % 60 === 0 ? `${v / 60} h` : `${v} min`);
  const intervalSelect = (value: number, onChange: (v: number) => void, label: string) => (
    <Select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 w-32">
      {[5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => <option key={m} value={m}>every {minutes(m)}</option>)}
      {![5, 10, 15, 30, 45, 60, 90, 120, 180, 240, 480].includes(value) && <option value={value}>every {minutes(value)}</option>}
    </Select>
  );

  return (
    <>
      <Section
        title="This device"
        description="Allow Remindora to show system notifications here."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant={permission === 'granted' ? 'secondary' : 'primary'} onClick={enableBrowser}><BellRing size={14} /> {permission === 'granted' ? 'Re-register' : 'Enable notifications'}</Button>
            <Button size="sm" onClick={() => api('/notifications/test', { body: { priority: 'HIGH' } }).then(() => toast('Test sent')).catch(reportError)}>Send test</Button>
          </div>
        }
      >
        <p className="text-xs text-ink-faint">Permission: {permission}. Android delivery uses Firebase Cloud Messaging; Android’s own channel, battery and Do Not Disturb settings always apply.</p>
      </Section>

      <Section title="Where to notify me" description="Choose how reminders reach you. Turn on as many as you like — each alert goes to every channel that’s on.">
        {([
          ['push', 'Phone notifications', 'Pop-up alerts on your Android phone, even when the app is closed.'],
          ['desktop', 'Desktop app notifications', 'System notifications from the Windows, Mac or Linux app (it keeps running in the tray).'],
          ['webPush', 'Browser notifications', 'Alerts from this website, even when the tab is closed. Turn on “This device” above first.'],
          ['inApp', 'Notification center', 'The bell inside Remindora. Recommended.'],
        ] as const).map(([k, label, hint]) => (
          <SettingRow key={k} label={label} hint={hint}><Switch checked={prefs.channels[k]} onCheckedChange={(v) => save({ channels: { [k]: v } })} aria-label={label} /></SettingRow>
        ))}
        <SettingRow label="Email" hint={emailEntitled ? `Send reminders to ${me?.email ?? 'your email'} too (once per reminder, plus the daily digest).` : 'Email reminders are a Premium feature.'}>
          {emailEntitled ? <Switch checked={prefs.channels.email} onCheckedChange={(v) => save({ channels: { email: v } })} aria-label="Email reminders" /> : <a href="/app/settings/billing" className="flex items-center gap-1 text-xs text-amber"><Sparkles size={12} /> Premium</a>}
        </SettingRow>
        {emailEntitled && prefs.channels.email && (
          <SettingRow label="Email every repeat of critical reminders" hint="Off: critical reminders are emailed once. On: every repeat is emailed too.">
            <Switch checked={prefs.criticalEmail} onCheckedChange={(v) => save({ criticalEmail: v })} aria-label="Email every critical repeat" />
          </SettingRow>
        )}
      </Section>

      <Section title="Priority alerts" description="Re-alerts continue until you complete, snooze, acknowledge or stop them — up to the maximum below.">
        <SettingRow label="Critical repeats" hint="Push + desktop on every device. Default 30 min.">{intervalSelect(prefs.criticalRepeatMinutes, (v) => save({ criticalRepeatMinutes: v }), 'Critical repeat interval')}</SettingRow>
        <SettingRow label="High repeats" hint="Default 2 hours.">{intervalSelect(prefs.highRepeatMinutes, (v) => save({ highRepeatMinutes: v }), 'High repeat interval')}</SettingRow>
        <SettingRow label="Medium follow-up" hint="One extra nudge, or none.">
          <Select aria-label="Medium follow-up" value={prefs.mediumFollowUpMinutes ?? 0} onChange={(e) => save({ mediumFollowUpMinutes: Number(e.target.value) || null })} className="h-9 w-32">
            <option value={0}>none</option>
            {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>after {minutes(m)}</option>)}
          </Select>
        </SettingRow>
        <SettingRow label="Maximum re-alerts" hint="Hard stop for repeating alerts.">
          <Input aria-label="Maximum re-alerts" type="number" min={0} max={50} defaultValue={prefs.maxRealerts} onBlur={(e) => Number(e.target.value) !== prefs.maxRealerts && save({ maxRealerts: Math.max(0, Math.min(50, Number(e.target.value))) })} className="h-9 w-20" />
        </SettingRow>
        <SettingRow label="Low & no priority" hint="Silent notification-center items, or only in the morning digest.">
          <Segmented label="Low priority delivery" value={prefs.lowPriorityMode} onChange={(v) => save({ lowPriorityMode: v })} options={[{ value: 'inbox', label: 'Silent item' }, { value: 'digest', label: 'Digest only' }]} />
        </SettingRow>
      </Section>

      <Section title="Quiet hours & weekends" description="Alerts that fall in quiet hours are delivered when they end.">
        <SettingRow label="Quiet hours"><Switch checked={prefs.quietHoursEnabled} onCheckedChange={(v) => save({ quietHoursEnabled: v })} aria-label="Quiet hours" /></SettingRow>
        {prefs.quietHoursEnabled && (
          <SettingRow label="From – to">
            <div className="flex items-center gap-2">
              <Input aria-label="Quiet hours start" type="time" value={prefs.quietStart} onChange={(e) => save({ quietStart: e.target.value })} className="h-9 w-28" />–
              <Input aria-label="Quiet hours end" type="time" value={prefs.quietEnd} onChange={(e) => save({ quietEnd: e.target.value })} className="h-9 w-28" />
            </div>
          </SettingRow>
        )}
        <SettingRow label="Critical alerts break through quiet hours" hint="Off by default."><Switch checked={prefs.criticalBypassQuietHours} onCheckedChange={(v) => save({ criticalBypassQuietHours: v })} aria-label="Critical bypasses quiet hours" /></SettingRow>
        <SettingRow label="Alerts on weekends" hint="When off, weekend alerts move to Monday morning."><Switch checked={prefs.weekendsEnabled} onCheckedChange={(v) => save({ weekendsEnabled: v })} aria-label="Weekend alerts" /></SettingRow>
        <SettingRow label="Timezone" hint="Change it under Profile."><span className="text-sm text-ink-muted">{prefs.timezone}</span></SettingRow>
      </Section>

      <Section title="Digests">
        <SettingRow label="Morning priority digest">
          <div className="flex items-center gap-2"><Input aria-label="Morning digest time" type="time" value={prefs.morningDigestTime} onChange={(e) => save({ morningDigestTime: e.target.value })} className="h-9 w-28" /><Switch checked={prefs.morningDigestEnabled} onCheckedChange={(v) => save({ morningDigestEnabled: v })} aria-label="Morning digest" /></div>
        </SettingRow>
        <SettingRow label="Evening planning reminder">
          <div className="flex items-center gap-2"><Input aria-label="Evening planning time" type="time" value={prefs.eveningPlanningTime} onChange={(e) => save({ eveningPlanningTime: e.target.value })} className="h-9 w-28" /><Switch checked={prefs.eveningPlanningEnabled} onCheckedChange={(v) => save({ eveningPlanningEnabled: v })} aria-label="Evening planning" /></div>
        </SettingRow>
      </Section>

      <Section title="Per-list overrides" description="Mute a list, or give it its own repeat intervals.">
        {projects.filter((p) => !p.archived).map((p) => {
          const o = prefs.projectOverrides.find((x) => x.projectId === p.id);
          const put = async (body: Record<string, unknown>) => {
            try {
              qc.setQueryData(keys.prefs, await api(`/notifications/preferences/projects/${p.id}`, { method: 'PUT', body: { muted: o?.muted ?? false, ...body } }));
            } catch (e) {
              reportError(e);
            }
          };
          return (
            <SettingRow key={p.id} label={p.isInbox ? 'Inbox' : p.name}>
              <div className="flex items-center gap-3">
                <Select aria-label={`Critical interval for ${p.name}`} value={o?.criticalRepeatMinutes ?? ''} onChange={(e) => put({ criticalRepeatMinutes: e.target.value ? Number(e.target.value) : null })} className="h-8 w-36 text-xs">
                  <option value="">critical: default</option>
                  {[10, 15, 30, 60].map((m) => <option key={m} value={m}>critical: {m} min</option>)}
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-ink-muted"><Switch checked={o?.muted ?? false} onCheckedChange={(v) => put({ muted: v })} aria-label={`Mute ${p.name}`} /> Mute</label>
              </div>
            </SettingRow>
          );
        })}
      </Section>

      <Section title="Delivery log" description="Every scheduled, delivered, opened, snoozed, failed, acknowledged and completed event.">
        <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3">
              <span className={`w-28 text-xs font-medium ${e.type === 'FAILED' ? 'text-danger' : e.type === 'DELIVERED' ? 'text-success' : 'text-cyan'}`}>{e.type.toLowerCase()}</span>
              <span className="flex-1 text-xs text-ink-muted">{e.channel?.toLowerCase().replace('_', ' ') ?? ''}</span>
              <span className="text-xs text-ink-faint">{relative(e.createdAt)}</span>
            </li>
          ))}
          {!events.length && <li className="text-ink-faint">No events yet.</li>}
        </ul>
      </Section>
    </>
  );
}
