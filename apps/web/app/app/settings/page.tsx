'use client';
import { Button, Input, Kbd, Segmented, Select, Switch } from '@remindora/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DownloadList } from '@/components/download-list';
import { Section, SettingRow } from '@/components/settings/section';
import { api } from '@/lib/api';
import { APP_VERSION } from '@/lib/config';
import { checkForUpdates } from '@/lib/desktop';
import { isTauri } from '@/lib/platform';
import { keys, reportError, useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

export default function ProfileSettings() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  const ui = useUi();
  const [name, setName] = useState('');
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']), []);
  useEffect(() => setName(me?.name ?? ''), [me?.name]);

  async function save(patch: Record<string, unknown>) {
    try {
      const user = await api<typeof me>('/auth/me', { method: 'PATCH', body: patch });
      if (user) setUser(user);
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Saved');
    } catch (e) {
      reportError(e);
    }
  }

  if (!me) return null;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <Section title="Profile">
        <SettingRow label="Name">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), save({ name }))}>
            <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-56" />
            <Button type="submit" size="sm" disabled={!name.trim() || name === me.name}>Save</Button>
          </form>
        </SettingRow>
        <SettingRow label="Email" hint="Used for sign-in codes and email reminders.">
          <span className="text-sm text-ink-muted">{me.email}</span>
        </SettingRow>
        <SettingRow label="Timezone" hint={me.timezone !== browserZone ? `This device is in ${browserZone}.` : 'Dates are stored in UTC and shown in this timezone.'}>
          <div className="flex gap-2">
            <Select aria-label="Timezone" value={me.timezone} onChange={(e) => save({ timezone: e.target.value })} className="h-9 w-60">
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            {me.timezone !== browserZone && <Button size="sm" onClick={() => save({ timezone: browserZone })}>Use device</Button>}
          </div>
        </SettingRow>
        <SettingRow label="Week starts on">
          <Segmented label="Week starts on" value={String(me.weekStartsOn)} onChange={(v) => save({ weekStartsOn: Number(v) })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }]} />
        </SettingRow>
      </Section>

      <Section title="Appearance & motion">
        <SettingRow label="Theme">
          <Segmented label="Theme" value={ui.theme} onChange={ui.setTheme} options={[{ value: 'observatory', label: 'Observatory (dark)' }, { value: 'daybreak', label: 'Daybreak (light)' }]} />
        </SettingRow>
        <SettingRow label="Reduce motion" hint="Replaces 3D and particle effects with simple fades. Your OS setting is always respected.">
          <Switch checked={ui.motion === 'reduced'} onCheckedChange={(v) => ui.setMotion(v ? 'reduced' : 'system')} aria-label="Reduce motion" />
        </SettingRow>
        <SettingRow label="3D orbit dashboard" hint="A lightweight WebGL view on Today. Pauses when hidden.">
          <Switch checked={ui.show3d} onCheckedChange={ui.setShow3d} aria-label="Show 3D dashboard" />
        </SettingRow>
      </Section>

      <Section title="Security">
        <SettingRow label="Approve new sign-ins from a signed-in device" hint="New email sign-ins wait for your approval when another device was active in the last 14 days.">
          <Switch checked={me.requireDeviceApproval} onCheckedChange={(v) => save({ requireDeviceApproval: v })} aria-label="Require device approval" />
        </SettingRow>
        <SettingRow label="Password" hint="We’ll email you a secure link to set a new password. Every device signs out afterwards.">
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api('/auth/password/forgot', { body: { email: me.email }, auth: false });
                toast(`Check ${me.email} for a link to set your password`);
              } catch (e) {
                reportError(e, 'Couldn’t send the email');
              }
            }}
          >
            Set or change password
          </Button>
        </SettingRow>
      </Section>

      <Section title="Download apps" description="Get Remindora on your phone and computer. Your tasks sync automatically.">
        <DownloadList currentVersion={isTauri() ? APP_VERSION : undefined} compact />
      </Section>

      {isTauri() && (
        <Section title="Desktop app" description="Quick Add from anywhere with ⌥⌘Space (macOS) or Alt+Ctrl+Space. Closing the window keeps Remindora in the tray so reminders keep arriving.">
          <SettingRow label="Updates">
            <Button size="sm" onClick={async () => { try { const r = await checkForUpdates(); toast(r === 'none' ? 'You’re up to date' : 'Updating…'); } catch (e) { reportError(e, 'Update check failed'); } }}>Check for updates</Button>
          </SettingRow>
        </Section>
      )}

      <Section title="About" description="Remindora is built by Jonathan Sakafu." actions={<a href="/about" className="text-sm text-cyan hover:underline">About Remindora →</a>}>
        <p className="text-sm text-ink-muted">Version {APP_VERSION}</p>
      </Section>

      <Section title="Keyboard shortcuts">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {[[['N'], 'Quick add'], [['⌘', 'K'], 'Command palette'], [['/'], 'Search'], [['G', 'T'], 'Go to Today'], [['G', 'I'], 'Go to Inbox'], [['G', 'C'], 'Go to Calendar'], [['C'], 'Complete focused task'], [['Enter'], 'Open focused task'], [['X'], 'Select for bulk actions'], [['Esc'], 'Close panel / clear selection']].map(([k, label]) => (
            <div key={label as string} className="flex items-center justify-between gap-3 border-b border-line/50 py-1.5">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="flex gap-1">{(k as string[]).map((x) => <Kbd key={x}>{x}</Kbd>)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
