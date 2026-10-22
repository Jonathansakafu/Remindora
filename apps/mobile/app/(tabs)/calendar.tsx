import type { TaskDTO } from '@remindora/types';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { TaskRow } from '../../src/components/TaskRow';
import { Empty, Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

interface CalData {
  tasks: TaskDTO[];
  events: Array<{ id: string; title: string; startAt: string; endAt: string; allDay: boolean; color: string }>;
}

export default function Calendar() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const today = DateTime.now().setZone(tz).startOf('day');
  const [selected, setSelected] = useState(today);
  const from = today.minus({ days: 3 });
  const to = today.plus({ days: 24 }).endOf('day');
  const { data } = useQuery({ queryKey: ['calendar', from.toISO(), to.toISO()], queryFn: () => api<CalData>(`/calendar?from=${encodeURIComponent(from.toUTC().toISO()!)}&to=${encodeURIComponent(to.toUTC().toISO()!)}&view=month`) });
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => from.plus({ days: i })), [from]);
  const onDay = (d: DateTime) => (data?.tasks ?? []).filter((t) => t.dueAt && DateTime.fromISO(t.dueAt).setZone(tz).hasSame(d, 'day'));
  const events = (data?.events ?? []).filter((e) => DateTime.fromISO(e.startAt).setZone(tz).hasSame(selected, 'day'));
  const tasks = onDay(selected).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));

  return (
    <Screen title="Calendar" subtitle={selected.toFormat('cccc, d LLLL')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingVertical: 8 }} style={{ flexGrow: 0 }}>
        {days.map((d) => {
          const active = d.hasSame(selected, 'day');
          const count = onDay(d).length;
          return (
            <Pressable key={d.toISODate()} onPress={() => setSelected(d)} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`${d.toFormat('cccc d LLLL')}, ${count} tasks`} style={{ width: 52, paddingVertical: 10, borderRadius: 16, alignItems: 'center', backgroundColor: active ? colors.cyan : 'rgba(17,28,62,0.7)', borderWidth: 1, borderColor: d.hasSame(today, 'day') ? colors.cyan : colors.border }}>
              <Text style={{ color: active ? '#06122E' : colors.textFaint, fontSize: 11, fontWeight: '600' }}>{d.toFormat('ccc')}</Text>
              <Text style={{ color: active ? '#06122E' : colors.text, fontSize: 18, fontWeight: '700' }}>{d.day}</Text>
              <View style={{ height: 6, flexDirection: 'row', gap: 2, marginTop: 2 }}>{Array.from({ length: Math.min(count, 3) }).map((_, i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: active ? '#06122E' : colors.violet }} />)}</View>
            </Pressable>
          );
        })}
      </ScrollView>
      {events.map((e) => (
        <View key={e.id} style={{ marginHorizontal: 20, marginTop: 6, padding: 10, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: e.color, backgroundColor: `${e.color}22` }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{e.title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{e.allDay ? 'All day' : `${DateTime.fromISO(e.startAt).setZone(tz).toFormat('HH:mm')}–${DateTime.fromISO(e.endAt).setZone(tz).toFormat('HH:mm')}`}</Text>
        </View>
      ))}
      <FlatList data={tasks} keyExtractor={(t) => t.id} renderItem={({ item }) => <TaskRow task={item} />} ListEmptyComponent={events.length ? undefined : <Empty title="Nothing scheduled" />} contentContainerStyle={{ paddingBottom: 96 }} />
    </Screen>
  );
}
