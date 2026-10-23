import type { HabitDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useTabBarSpace } from '../../src/lib/layout';
import { keys, showError, useHabits } from '../../src/lib/queries';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

/** Daily checklist: items are daily habits, so ticks reset every morning and history is kept. */
export default function Checklist() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const tabSpace = useTabBarSpace();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useHabits();
  const [text, setText] = useState('');
  const today = DateTime.now().setZone(tz);
  const date = today.toISODate()!;
  const list = items.filter((h) => !h.archived);
  const done = list.filter((h) => h.checkIns.includes(date)).length;

  async function add() {
    const name = text.trim();
    if (!name) return;
    setText('');
    try {
      const created = await api<HabitDTO>('/habits', { body: { name, frequency: 'DAILY' } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => [...(prev ?? []), created]);
    } catch (e) {
      showError(e);
    }
  }

  async function toggle(h: HabitDTO) {
    const next = !h.checkIns.includes(date);
    qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.map((x) => (x.id === h.id ? { ...x, checkIns: next ? [...x.checkIns, date] : x.checkIns.filter((d) => d !== date) } : x)));
    try {
      const updated = await api<HabitDTO>(`/habits/${h.id}/check-in`, { body: { date, done: next } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.map((x) => (x.id === h.id ? updated : x)));
    } catch (e) {
      showError(e);
      void qc.invalidateQueries({ queryKey: keys.habits });
    }
  }

  function remove(h: HabitDTO) {
    Alert.alert(`Remove “${h.name}”?`, 'It will no longer appear on your daily checklist.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          qc.setQueryData<HabitDTO[]>(keys.habits, (prev) => prev?.filter((x) => x.id !== h.id));
          await api(`/habits/${h.id}`, { method: 'DELETE' }).catch(showError);
        },
      },
    ]);
  }

  return (
    <Screen title="Daily checklist" subtitle={`${today.toFormat('cccc d LLLL')} · starts fresh every morning`}>
      <View style={{ paddingHorizontal: 16 }}>
        {list.length > 0 ? (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {done} of {list.length} done{done === list.length ? '  🎉' : ''}
            </Text>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 8, overflow: 'hidden' }}>
              <View style={{ width: `${(done / list.length) * 100}%`, height: '100%', backgroundColor: colors.success, borderRadius: 4 }} />
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={add}
            returnKeyType="done"
            placeholder="Add an item, e.g. Drink water"
            placeholderTextColor={colors.textFaint}
            maxLength={80}
            accessibilityLabel="New checklist item"
            style={{ flex: 1, color: colors.text, fontSize: 16, backgroundColor: 'rgba(17,28,62,0.8)', borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 52 }}
          />
          <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add item" style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ color: '#06122E', fontSize: 26, fontWeight: '800', marginTop: -2 }}>+</Text>
          </Pressable>
        </View>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.cyan} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(h) => h.id}
          contentContainerStyle={{ padding: 16, paddingBottom: tabSpace + 32 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 32 }}>
              <Text style={{ fontSize: 40 }}>☑</Text>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 10 }}>Your checklist is empty</Text>
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 6 }}>Add the things you want to do every day and tick them off as you go.</Text>
            </View>
          }
          renderItem={({ item: h }) => {
            const checked = h.checkIns.includes(date);
            return (
              <Pressable
                onPress={() => toggle(h)}
                onLongPress={() => remove(h)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityHint="Long-press to remove"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 14, marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(17,28,62,0.7)', opacity: pressed ? 0.8 : 1 })}
              >
                <View style={{ width: 30, height: 30, borderRadius: 9, borderWidth: 2, borderColor: checked ? colors.success : colors.borderStrong, backgroundColor: checked ? colors.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {checked ? <Text style={{ color: '#06122E', fontWeight: '900', fontSize: 17 }}>✓</Text> : null}
                </View>
                <Text style={{ flex: 1, color: checked ? colors.textFaint : colors.text, fontSize: 17, textDecorationLine: checked ? 'line-through' : 'none' }}>{h.name}</Text>
                {h.currentStreak > 1 ? <Text style={{ color: colors.textFaint, fontSize: 12 }}>{h.currentStreak} days</Text> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
