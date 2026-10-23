import { priorityMeta } from '@remindora/ui/tokens';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Empty, Screen } from '../src/components/ui';
import { api } from '../src/lib/api';
import { dismissPresented } from '../src/lib/realtime';
import { keys, refetchTasks, showError, useNotifications } from '../src/lib/queries';
import { colors } from '../src/lib/theme';

export default function NotificationsScreen() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  async function act(id: string, reminderId: string | null, body: Record<string, unknown>) {
    try {
      await api(`/notifications/${id}/action`, { body });
      await dismissPresented(id, reminderId);
      void qc.invalidateQueries({ queryKey: keys.notifications });
      refetchTasks(qc);
    } catch (e) {
      showError(e);
    }
  }
  return (
    <Screen title="Notifications" back>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(n) => n.id}
        ListEmptyComponent={<Empty title="All quiet" body="Reminders and mentions show up here." />}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item: n }) => {
          const open = !n.acknowledgedAt;
          return (
            <View style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderColor: open ? colors.borderStrong : colors.border, backgroundColor: 'rgba(17,28,62,0.6)', opacity: open ? 1 : 0.55 }}>
              <Pressable onPress={() => n.taskId && router.push({ pathname: '/task', params: { id: n.taskId } })} accessibilityRole="button">
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{n.title}</Text>
                  <Text style={{ color: priorityMeta[n.priority as keyof typeof priorityMeta].color, fontSize: 11, fontWeight: '800' }}>{priorityMeta[n.priority as keyof typeof priorityMeta].short}</Text>
                </View>
                <Text style={{ color: colors.textMuted, marginTop: 2 }}>{n.body}</Text>
                <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 4 }}>{DateTime.fromISO(n.createdAt).toRelative()}</Text>
              </Pressable>
              {open && n.actions.includes('snooze') ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  {[['Complete', { action: 'complete' }], ['Snooze 10m', { action: 'snooze', snoozeMinutes: 10 }], ['Stop', { action: 'stop' }]].map(([label, body]) => (
                    <Pressable key={label as string} onPress={() => act(n.id, n.reminderId, body as Record<string, unknown>)} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: label === 'Complete' ? colors.cyan : 'rgba(255,255,255,0.06)' }}>
                      <Text style={{ color: label === 'Complete' ? '#06122E' : colors.text, fontWeight: '600' }}>{label as string}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}
