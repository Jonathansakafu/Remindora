import type { NotificationPreferenceDTO } from '@remindora/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Switch, Text, View } from 'react-native';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import { Glass } from './ui';

type ChannelKey = keyof NotificationPreferenceDTO['channels'];

const ROWS: Array<{ key: ChannelKey; label: string; hint: string }> = [
  { key: 'push', label: 'Phone notifications', hint: 'Pop-up alerts on this phone, even when Remindora is closed.' },
  { key: 'email', label: 'Email', hint: 'Also send reminders to your email (once per reminder, plus the daily summary).' },
  { key: 'desktop', label: 'Desktop app', hint: 'Notifications in the Windows, Mac or Linux app.' },
  { key: 'webPush', label: 'Web browser', hint: 'Notifications from the Remindora website.' },
];

const PREFS_KEY = ['notification-prefs'] as const;

/** Same preferences as the web/desktop "Where to notify me" section — they apply to every device. */
export function NotificationChannels({ email }: { email?: string }) {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({ queryKey: PREFS_KEY, queryFn: () => api<NotificationPreferenceDTO>('/notifications/preferences') });

  async function save(patch: Omit<Partial<NotificationPreferenceDTO>, 'channels'> & { channels?: Partial<NotificationPreferenceDTO['channels']> }) {
    const previous = qc.getQueryData<NotificationPreferenceDTO>(PREFS_KEY);
    qc.setQueryData<NotificationPreferenceDTO>(PREFS_KEY, (p) => (p ? { ...p, ...patch, channels: { ...p.channels, ...(patch.channels ?? {}) } } : p));
    try {
      qc.setQueryData(PREFS_KEY, await api<NotificationPreferenceDTO>('/notifications/preferences', { method: 'PATCH', body: patch }));
    } catch (e) {
      qc.setQueryData(PREFS_KEY, previous);
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : 'Check your connection and try again.');
    }
  }

  if (isLoading || !prefs) {
    return (
      <Glass>
        <Text style={{ color: colors.textFaint }}>Loading…</Text>
      </Glass>
    );
  }

  const row = (label: string, hint: string, value: boolean, onChange: (v: boolean) => void, last = false) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: colors.text }}>{label}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 2 }}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: colors.cyan, false: colors.surface }} />
    </View>
  );

  return (
    <Glass>
      {ROWS.map((r) => row(r.label, r.key === 'email' && email ? `Also send reminders to ${email} (once per reminder, plus the daily summary).` : r.hint, prefs.channels[r.key], (v) => void save({ channels: { [r.key]: v } })))}
      {prefs.channels.email && row('Email every repeat of critical reminders', 'Off: critical reminders are emailed once.', prefs.criticalEmail, (v) => void save({ criticalEmail: v }))}
      {row('Morning summary', `Your priorities for the day at ${prefs.morningDigestTime}.`, prefs.morningDigestEnabled, (v) => void save({ morningDigestEnabled: v }), true)}
    </Glass>
  );
}
