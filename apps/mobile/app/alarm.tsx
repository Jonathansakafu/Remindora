import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api';
import { startAlarm, stopAlarm, useAlarm, type RingingAlarm } from '../src/lib/alarm';
import { colors } from '../src/lib/theme';

const SNOOZES = [5, 10, 15, 30];

/** Full-screen ringing alarm (app open). */
export default function AlarmScreen() {
  const current = useAlarm((s) => s.queue[0]);
  const dismiss = useAlarm((s) => s.dismiss);
  const qc = useQueryClient();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!current) {
      stopAlarm();
      if (router.canGoBack()) router.back();
      else router.replace('/reminders');
      return;
    }
    setNow(new Date());
    void startAlarm();
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [current]);

  useEffect(() => () => stopAlarm(), []);

  if (!current) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  async function act(a: RingingAlarm, action: 'acknowledge' | 'complete' | 'snooze', snoozeMinutes?: number) {
    stopAlarm();
    dismiss(a.notificationId);
    if (a.test) return;
    await api(`/notifications/${a.notificationId}/action`, { body: snoozeMinutes ? { action, snoozeMinutes } : { action } }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  }

  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(96,233,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 40 }} accessible={false}>⏰</Text>
          </View>
        </View>
        <Text style={{ color: colors.text, fontSize: 56, fontWeight: '700', marginTop: 24, fontVariant: ['tabular-nums'] }}>{time}</Text>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
          {current.title}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 15, marginTop: 6, textAlign: 'center' }}>{current.body}</Text>
      </View>

      <Pressable onPress={() => act(current, 'acknowledge')} accessibilityRole="button" accessibilityLabel="Stop alarm" style={({ pressed }) => ({ marginTop: 40, height: 68, borderRadius: 20, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
        <Text style={{ color: '#06122E', fontSize: 22, fontWeight: '800' }}>Stop</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {SNOOZES.map((m) => (
          <Pressable key={m} onPress={() => act(current, 'snooze', m)} accessibilityRole="button" accessibilityLabel={`Snooze ${m} minutes`} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{m} min</Text>
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>snooze</Text>
          </Pressable>
        ))}
      </View>
      {current.taskId ? (
        <Pressable onPress={() => act(current, 'complete')} accessibilityRole="button" style={{ marginTop: 16, alignItems: 'center', padding: 12 }}>
          <Text style={{ color: colors.textMuted, fontSize: 15 }}>✓ Mark as done</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
