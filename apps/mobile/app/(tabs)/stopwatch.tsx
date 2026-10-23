import { ANDROID_CHANNELS } from '@remindora/notifications/dist/android';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen } from '../../src/components/ui';
import { useAlarm } from '../../src/lib/alarm';
import { useTabBarSpace } from '../../src/lib/layout';
import { colors } from '../../src/lib/theme';

type Watch = { startedAt: number | null; elapsed: number; laps: number[] };
type Countdown = { endsAt: number | null; remaining: number; total: number; notificationId?: string | null };

const WATCH_KEY = 'remindora.stopwatch';
const TIMER_KEY = 'remindora.timer';
const PRESETS = [1, 5, 10, 15, 30, 60];

function fmt(ms: number, centis = true) {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const base = `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return centis ? `${base}.${String(cs).padStart(2, '0')}` : base;
}

function useTick(active: boolean, ms = 50) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

function BigButton({ label, onPress, primary, warn, disabled }: { label: string; onPress: () => void; primary?: boolean; warn?: boolean; disabled?: boolean }) {
  const bg = warn ? colors.amber : primary ? colors.cyan : 'rgba(17,28,62,0.9)';
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 60, borderRadius: 18, backgroundColor: bg, borderWidth: primary || warn ? 0 : 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
      <Text style={{ color: primary || warn ? '#06122E' : colors.text, fontSize: 18, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function Stopwatch() {
  const [w, setW] = useState<Watch>({ startedAt: null, elapsed: 0, laps: [] });
  useEffect(() => {
    void AsyncStorage.getItem(WATCH_KEY).then((v) => v && setW(JSON.parse(v)));
  }, []);
  const update = (next: Watch) => {
    setW(next);
    void AsyncStorage.setItem(WATCH_KEY, JSON.stringify(next));
  };
  const running = w.startedAt !== null;
  useTick(running);
  const now = w.elapsed + (running ? Date.now() - w.startedAt! : 0);
  return (
    <View>
      <Text accessibilityRole="timer" style={{ color: colors.text, fontSize: 64, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'], marginVertical: 28 }}>{fmt(now)}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {running ? <BigButton label="Lap" onPress={() => update({ ...w, laps: [now, ...w.laps] })} /> : <BigButton label="Reset" disabled={now === 0} onPress={() => update({ startedAt: null, elapsed: 0, laps: [] })} />}
        <BigButton label={running ? 'Pause' : now ? 'Resume' : 'Start'} primary={!running} warn={running} onPress={() => update(running ? { ...w, startedAt: null, elapsed: now } : { ...w, startedAt: Date.now() })} />
      </View>
      {w.laps.map((t, i) => {
        const n = w.laps.length - i;
        return (
          <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.textMuted }}>Lap {n}</Text>
            <Text style={{ color: colors.text, fontVariant: ['tabular-nums'] }}>{fmt(t - (w.laps[i + 1] ?? 0))}</Text>
            <Text style={{ color: colors.textFaint, fontVariant: ['tabular-nums'] }}>{fmt(t)}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Countdown that rings the alarm. A local notification on the Alarms channel covers the app being closed. */
function Timer() {
  const ring = useAlarm((s) => s.ring);
  const [t, setT] = useState<Countdown>({ endsAt: null, remaining: 5 * 60_000, total: 5 * 60_000 });
  const [custom, setCustom] = useState('5');
  const fired = useRef(false);
  useEffect(() => {
    void AsyncStorage.getItem(TIMER_KEY).then((v) => v && setT(JSON.parse(v)));
  }, []);
  const update = (next: Countdown) => {
    setT(next);
    void AsyncStorage.setItem(TIMER_KEY, JSON.stringify(next));
  };
  const running = t.endsAt !== null;
  useTick(running, 250);
  const left = running ? t.endsAt! - Date.now() : t.remaining;

  useEffect(() => {
    if (running && left <= 0 && !fired.current) {
      fired.current = true;
      if (t.notificationId) void Notifications.cancelScheduledNotificationAsync(t.notificationId);
      update({ endsAt: null, remaining: t.total, total: t.total, notificationId: null });
      ring({ notificationId: `timer-${Date.now()}`, taskId: null, title: 'Time’s up!', body: `Your ${fmt(t.total, false)} timer has finished.`, test: true });
    }
  });

  async function start() {
    fired.current = false;
    const endsAt = Date.now() + t.remaining;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: { title: 'Time’s up!', body: `Your ${fmt(t.total, false)} timer has finished.`, data: { type: 'timer' }, sound: 'remindora_alarm.wav' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(endsAt), channelId: ANDROID_CHANNELS.alarm.id },
    }).catch(() => null);
    update({ ...t, endsAt, notificationId });
  }
  function stop(reset: boolean) {
    if (t.notificationId) void Notifications.cancelScheduledNotificationAsync(t.notificationId);
    update(reset ? { endsAt: null, remaining: t.total, total: t.total, notificationId: null } : { ...t, endsAt: null, remaining: left, notificationId: null });
  }
  const set = (m: number) => {
    setCustom(String(m));
    update({ endsAt: null, remaining: m * 60_000, total: m * 60_000, notificationId: null });
  };

  return (
    <View>
      <Text accessibilityRole="timer" style={{ color: running && left < 10_000 ? colors.amber : colors.text, fontSize: 64, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'], marginVertical: 28 }}>{fmt(left, false)}</Text>
      {!running ? (
        <View style={{ marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {PRESETS.map((m) => {
              const on = t.total === m * 60_000;
              return (
                <Pressable key={m} onPress={() => set(m)} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? colors.cyan : colors.border }}>
                  <Text style={{ color: on ? colors.cyan : colors.text, fontWeight: '600' }}>{m < 60 ? `${m} min` : '1 hour'}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
            <Text style={{ color: colors.textMuted }}>Custom</Text>
            <TextInput
              value={custom}
              onChangeText={(v) => {
                setCustom(v);
                const m = Number(v);
                if (m >= 1 && m <= 600) update({ endsAt: null, remaining: m * 60_000, total: m * 60_000, notificationId: null });
              }}
              keyboardType="number-pad"
              maxLength={3}
              accessibilityLabel="Minutes"
              style={{ width: 70, height: 44, color: colors.text, textAlign: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 16 }}
            />
            <Text style={{ color: colors.textMuted }}>minutes</Text>
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <BigButton label="Reset" onPress={() => stop(true)} />
        <BigButton label={running ? 'Pause' : 'Start'} primary={!running} warn={running} onPress={() => (running ? stop(false) : void start())} />
      </View>
      <Text style={{ color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: 16 }}>The alarm rings when time is up — even if you leave the app.</Text>
    </View>
  );
}

export default function StopwatchTab() {
  const tabSpace = useTabBarSpace();
  const [mode, setMode] = useState<'stopwatch' | 'timer'>('stopwatch');
  return (
    <Screen title={mode === 'stopwatch' ? 'Stopwatch' : 'Timer'}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: tabSpace + 32 }}>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(17,28,62,0.8)', borderRadius: 14, padding: 4 }} accessibilityRole="tablist">
          {(['stopwatch', 'timer'] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={{ flex: 1, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? colors.surfaceHigh : 'transparent' }}>
              <Text style={{ color: mode === m ? colors.text : colors.textMuted, fontWeight: '700' }}>{m === 'stopwatch' ? 'Stopwatch' : 'Timer'}</Text>
            </Pressable>
          ))}
        </View>
        {mode === 'stopwatch' ? <Stopwatch /> : <Timer />}
      </ScrollView>
    </Screen>
  );
}
