import type { FocusSessionDTO } from '@remindora/types';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Glass, Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { showError } from '../../src/lib/queries';
import { colors } from '../../src/lib/theme';

const PHASES = { FOCUS: 25, SHORT_BREAK: 5, LONG_BREAK: 15 } as const;
type Phase = keyof typeof PHASES;

export default function Focus() {
  const [phase, setPhase] = useState<Phase>('FOCUS');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(PHASES.FOCUS * 60_000);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cycle, setCycle] = useState(1);
  const scheduled = useRef<string | null>(null);

  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => {
      const left = endsAt - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) void finish(true);
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  async function start() {
    try {
      const s = await api<FocusSessionDTO>('/focus/start', { body: { kind: phase, plannedMinutes: PHASES[phase] } });
      setSessionId(s.id);
      const end = Date.now() + remaining;
      setEndsAt(end);
      // Local notification so the end of a session is announced even if the app is backgrounded.
      scheduled.current = await Notifications.scheduleNotificationAsync({
        content: { title: phase === 'FOCUS' ? 'Focus session complete' : 'Break’s over', body: phase === 'FOCUS' ? 'Nice work — take a break.' : 'Ready for the next focus block?' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(end), channelId: 'remindora-default' },
      });
    } catch (e) {
      showError(e);
    }
  }

  function pause() {
    setEndsAt(null);
    if (scheduled.current) void Notifications.cancelScheduledNotificationAsync(scheduled.current);
  }

  async function finish(completed: boolean) {
    setEndsAt(null);
    if (scheduled.current && !completed) void Notifications.cancelScheduledNotificationAsync(scheduled.current);
    if (sessionId) await api(`/focus/${sessionId}/finish`, { body: { completed, actualSeconds: Math.round((PHASES[phase] * 60_000 - remaining) / 1000) } }).catch(() => undefined);
    setSessionId(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next: Phase = phase === 'FOCUS' ? (cycle % 4 === 0 ? 'LONG_BREAK' : 'SHORT_BREAK') : 'FOCUS';
    if (phase !== 'FOCUS') setCycle((c) => (phase === 'LONG_BREAK' ? 1 : c + 1));
    setPhase(next);
    setRemaining(PHASES[next] * 60_000);
  }

  const mm = String(Math.floor(remaining / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0');
  return (
    <Screen back="/more" title="Focus" subtitle={`${phase === 'FOCUS' ? 'Focus' : phase === 'SHORT_BREAK' ? 'Short break' : 'Long break'} · cycle ${cycle}/4`}>
      <View style={{ padding: 20 }}>
        <Glass style={{ alignItems: 'center' }}>
          <Text accessibilityRole="timer" accessibilityLabel={`${mm} minutes ${ss} seconds remaining`} style={{ color: colors.cyan, fontSize: 76, fontWeight: '300', fontVariant: ['tabular-nums'], marginVertical: 24 }}>
            {mm}:{ss}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}>{endsAt ? <Button label="Pause" onPress={pause} /> : <Button label={sessionId ? 'Resume' : 'Start'} variant="primary" onPress={() => (sessionId ? setEndsAt(Date.now() + remaining) : start())} />}</View>
            <View style={{ flex: 1 }}><Button label="Skip" variant="ghost" onPress={() => finish(false)} /></View>
          </View>
        </Glass>
      </View>
    </Screen>
  );
}
