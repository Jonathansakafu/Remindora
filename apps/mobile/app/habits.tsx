import type { HabitDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Empty, Screen } from '../src/components/ui';
import { api } from '../src/lib/api';
import { keys, showError, useHabits } from '../src/lib/queries';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';

export default function Habits() {
  const { data = [] } = useHabits();
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const qc = useQueryClient();
  const today = DateTime.now().setZone(tz).toISODate()!;
  async function toggle(h: HabitDTO) {
    const done = !h.checkIns.includes(today);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const updated = await api<HabitDTO>(`/habits/${h.id}/check-in`, { body: { date: today, done } });
      qc.setQueryData<HabitDTO[]>(keys.habits, (l) => l?.map((x) => (x.id === h.id ? updated : x)));
    } catch (e) {
      showError(e);
    }
  }
  return (
    <Screen title="Habits" back>
      <FlatList
        data={data}
        keyExtractor={(h) => h.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Empty title="No habits yet" body="Create habits on the web or desktop app." />}
        renderItem={({ item: h }) => {
          const done = h.checkIns.includes(today);
          return (
            <Pressable onPress={() => toggle(h)} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`${h.name}, streak ${h.currentStreak} days`} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: done ? h.color : colors.border, backgroundColor: done ? `${h.color}22` : 'rgba(17,28,62,0.6)' }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: h.color, backgroundColor: done ? h.color : 'transparent', marginRight: 12 }} />
              <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>{h.name}</Text>
              <Text style={{ color: h.currentStreak ? colors.amber : colors.textFaint, fontWeight: '700' }}>🔥 {h.currentStreak}</Text>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
