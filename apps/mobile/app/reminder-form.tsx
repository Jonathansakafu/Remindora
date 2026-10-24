import { ALARM_SOUNDS, CUSTOM_UNITS, customOffset, DEFAULT_ALARM_SOUND, normalizeAlarmSound, offsetLabel, REMIND_PRESETS, REPEAT_OPTIONS, repeatFromRrule, rruleFor, type AlarmSound, type CustomUnit, type RepeatValue } from '@remindora/core';
import type { TaskDTO } from '@remindora/types';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen } from '../src/components/ui';
import { previewAlarm } from '../src/lib/alarm';
import { api } from '../src/lib/api';
import { useSystemBottom } from '../src/lib/layout';
import { refetchTasks } from '../src/lib/queries';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

const field = { color: colors.text, fontSize: 17, backgroundColor: 'rgba(17,28,62,0.8)', borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14 } as const;

function Label({ children }: { children: string }) {
  return <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>{children}</Text>;
}

/** The reminder form: what, date, time, repeat, notes. */
export default function ReminderForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const qc = useQueryClient();
  const systemBottom = useSystemBottom();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState(() => DateTime.now().setZone(tz).plus({ hours: 1 }).startOf('hour'));
  const [repeat, setRepeat] = useState<RepeatValue>('none');
  const [sound, setSound] = useState<AlarmSound>(DEFAULT_ALARM_SOUND);
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [customAmount, setCustomAmount] = useState('3');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('days');
  const toggleOffset = (m: number) => setOffsets((o) => (o.includes(m) ? o.filter((x) => x !== m) : [...o, m].sort((a, b) => a - b)));
  const addCustom = () => {
    const m = customOffset(Number(customAmount), customUnit);
    if (m === null) return Alert.alert('Custom reminder', 'Use a number between 1 minute and 30 days.');
    setOffsets((o) => (o.includes(m) ? o : [...o, m].sort((a, b) => a - b)));
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void api<TaskDTO>(`/tasks/${id}`).then((t) => {
      setTitle(t.title);
      setNotes(t.description ?? '');
      if (t.dueAt) setWhen(DateTime.fromISO(t.dueAt).setZone(tz));
      setRepeat(repeatFromRrule(t.recurrence?.rrule));
      setSound(normalizeAlarmSound(t.alarmSound));
      const existing = t.reminders.filter((r) => !r.subtaskId && !r.at).map((r) => r.offsetMinutes ?? 0);
      if (existing.length) setOffsets([...new Set(existing)].sort((a, b) => a - b));
    });
  }, [id, tz]);

  // Pickers work in device-local JS Dates; keep the wall-clock values in the account zone.
  const asLocalDate = () => new Date(when.year, when.month - 1, when.day, when.hour, when.minute);
  const pickDate = () =>
    DateTimePickerAndroid.open({
      value: asLocalDate(),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (e, d) => e.type === 'set' && d && setWhen(when.set({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() })),
    });
  const pickTime = () =>
    DateTimePickerAndroid.open({
      value: asLocalDate(),
      mode: 'time',
      is24Hour: true,
      onChange: (e, d) => e.type === 'set' && d && setWhen(when.set({ hour: d.getHours(), minute: d.getMinutes(), second: 0 })),
    });

  const inPast = repeat === 'none' && when < DateTime.now();

  async function save() {
    if (!title.trim()) return Alert.alert('What should I remind you about?', 'Type a short description first.');
    if (inPast) return Alert.alert('That time has passed', 'Pick a later time or another day.');
    // Early reminders whose time has already passed would ring immediately: skip them.
    const now = DateTime.now();
    const valid = offsets.filter((m) => m === 0 || repeat !== 'none' || when.minus({ minutes: m }) > now);
    if (!valid.length) return Alert.alert('When should I remind you?', 'Pick at least one time under “Remind me”.');
    setBusy(true);
    const rrule = rruleFor(repeat);
    const body = { title: title.trim(), description: notes.trim() || null, dueAt: when.toUTC().toISO(), allDay: false, alarmSound: sound, reminders: valid.map((offsetMinutes) => ({ offsetMinutes })), recurrence: rrule ? { rrule } : null };
    try {
      if (id) await api(`/tasks/${id}`, { method: 'PATCH', body });
      else await api('/tasks', { body: { ...body, description: body.description ?? undefined, recurrence: body.recurrence ?? undefined } });
      refetchTasks(qc);
      router.back();
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={id ? 'Edit reminder' : 'New reminder'}
      right={
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}>
          <Text style={{ color: colors.cyan, fontSize: 16 }}>Cancel</Text>
        </Pressable>
      }
    >
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + systemBottom }} keyboardShouldPersistTaps="handled">
          <Label>What should I remind you about?</Label>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Take medicine, Call mom, Pay rent" placeholderTextColor={colors.textFaint} style={field} autoFocus={!id} maxLength={200} accessibilityLabel="What should I remind you about?" />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Label>Date</Label>
              <Pressable onPress={pickDate} accessibilityRole="button" accessibilityLabel={`Date, ${when.toFormat('cccc d LLLL')}`} style={field}>
                <Text style={{ color: colors.text, fontSize: 17 }}>📅  {when.toFormat('ccc d LLL')}</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Label>Time</Label>
              <Pressable onPress={pickTime} accessibilityRole="button" accessibilityLabel={`Time, ${when.toFormat('HH:mm')}`} style={field}>
                <Text style={{ color: colors.text, fontSize: 17 }}>🕒  {when.toFormat('HH:mm')}</Text>
              </Pressable>
            </View>
          </View>

          <Label>Repeat</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REPEAT_OPTIONS.map((o) => {
              const on = repeat === o.value;
              return (
                <Pressable key={o.value} onPress={() => setRepeat(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? colors.cyan : colors.border, backgroundColor: on ? 'rgba(96,233,255,0.15)' : 'transparent' }}>
                  <Text style={{ color: on ? colors.cyan : colors.text, fontWeight: '600' }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Label>Remind me</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[...new Set([...REMIND_PRESETS.map((p) => p.minutes as number), ...offsets])].sort((a, b) => a - b).map((m) => {
              const on = offsets.includes(m);
              return (
                <Pressable key={m} onPress={() => toggleOffset(m)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? colors.cyan : colors.border, backgroundColor: on ? 'rgba(96,233,255,0.15)' : 'transparent' }}>
                  <Text style={{ color: on ? colors.cyan : colors.text, fontWeight: '600' }}>{on ? '✓ ' : ''}{offsetLabel(m)}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.textMuted }}>Custom</Text>
            <TextInput value={customAmount} onChangeText={setCustomAmount} keyboardType="number-pad" maxLength={3} accessibilityLabel="Custom amount" style={{ width: 56, height: 44, color: colors.text, textAlign: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 16 }} />
            {CUSTOM_UNITS.map((u) => (
              <Pressable key={u.value} onPress={() => setCustomUnit(u.value)} accessibilityRole="radio" accessibilityState={{ checked: customUnit === u.value }} style={{ paddingHorizontal: 10, height: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: customUnit === u.value ? colors.cyan : colors.border }}>
                <Text style={{ color: customUnit === u.value ? colors.cyan : colors.text }}>{u.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={addCustom} accessibilityRole="button" style={{ paddingHorizontal: 14, height: 44, justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(96,233,255,0.15)' }}>
              <Text style={{ color: colors.cyan, fontWeight: '700' }}>+ Add</Text>
            </Pressable>
          </View>

          <Label>Sound</Label>
          <View style={{ gap: 8 }}>
            {ALARM_SOUNDS.map((o) => {
              const on = sound === o.value;
              return (
                <View key={o.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pressable onPress={() => setSound(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 48, borderRadius: 12, borderWidth: 1, borderColor: on ? colors.cyan : colors.border, backgroundColor: on ? 'rgba(96,233,255,0.15)' : 'transparent' }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? colors.cyan : colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyan }} /> : null}</View>
                    <Text style={{ color: on ? colors.cyan : colors.text, fontWeight: '600' }}>{o.label}</Text>
                  </Pressable>
                  <Pressable onPress={() => void previewAlarm(o.value)} accessibilityRole="button" accessibilityLabel={`Play ${o.label}`} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.text, fontSize: 16 }}>▶</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Label>Notes (optional)</Label>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Anything else to remember" placeholderTextColor={colors.textFaint} style={[field, { minHeight: 80, textAlignVertical: 'top' }]} multiline maxLength={2000} accessibilityLabel="Notes" />

          {inPast ? <Text style={{ color: colors.amber, marginTop: 12 }}>That time has already passed — pick a later time or another day.</Text> : null}

          <Pressable onPress={save} disabled={busy} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 28, height: 60, borderRadius: 18, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}>
            <Text style={{ color: '#06122E', fontSize: 18, fontWeight: '800' }}>{busy ? 'Saving…' : id ? 'Save changes' : '⏰  Set reminder'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
