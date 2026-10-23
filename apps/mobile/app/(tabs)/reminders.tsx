import { repeatLabel } from '@remindora/core';
import type { TaskDTO } from '@remindora/types';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, Text, View } from 'react-native';
import { Screen } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useTabBarSpace } from '../../src/lib/layout';
import { OrbitHero } from '../../src/components/OrbitHero';
import { refetchTasks, useComplete, useHabits, useTasks } from '../../src/lib/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../src/lib/session';
import { colors } from '../../src/lib/theme';

function groupLabel(d: DateTime, now: DateTime) {
  if (d < now) return 'Missed';
  if (d.hasSame(now, 'day')) return 'Today';
  if (d.hasSame(now.plus({ days: 1 }), 'day')) return 'Tomorrow';
  return d.toFormat('cccc d LLLL');
}

function Row({ task, tz, missed }: { task: TaskDTO; tz: string; missed: boolean }) {
  const complete = useComplete();
  const qc = useQueryClient();
  const due = DateTime.fromISO(task.dueAt!).setZone(tz);
  const repeat = repeatLabel(task.recurrence?.rrule);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/reminder-form', params: { id: task.id } })}
      onLongPress={() =>
        Alert.alert(task.title, undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void api(`/tasks/${task.id}`, { method: 'DELETE' }).then(() => refetchTasks(qc)) },
        ])
      }
      accessibilityRole="button"
      accessibilityHint="Opens the reminder to edit. Long-press to delete."
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: missed ? 'rgba(255,122,147,0.45)' : colors.border, backgroundColor: 'rgba(17,28,62,0.7)', opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ width: 70, alignItems: 'center' }}>
        <Text style={{ color: missed ? colors.danger : colors.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{due.toFormat('HH:mm')}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12 }}>{due.toFormat('ccc d LLL')}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
          {[missed ? 'Missed' : null, repeat ? `↻ ${repeat}` : null, task.description].filter(Boolean).join('  ·  ')}
        </Text>
      </View>
      <Pressable
        onPress={() => complete.mutate({ task, done: true })}
        accessibilityRole="button"
        accessibilityLabel={`Mark ${task.title} as done`}
        hitSlop={8}
        style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.cyan, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: colors.cyan, fontSize: 18, fontWeight: '800' }}>✓</Text>
      </Pressable>
    </Pressable>
  );
}

export default function Reminders() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const tabSpace = useTabBarSpace();
  const { data: tasks = [], isLoading, refetch, isRefetching } = useTasks({ view: 'reminders' });
  const { data: checklist = [] } = useHabits();

  const sections = useMemo(() => {
    const now = DateTime.now().setZone(tz);
    const map = new Map<string, TaskDTO[]>();
    for (const t of tasks.filter((t) => t.dueAt && !t.completedAt)) {
      const label = groupLabel(DateTime.fromISO(t.dueAt!).setZone(tz), now);
      map.set(label, [...(map.get(label) ?? []), t]);
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }));
  }, [tasks, tz]);

  const hero = useMemo(() => {
    const now = DateTime.now().setZone(tz);
    const open = tasks.filter((t) => t.dueAt && !t.completedAt);
    const next = open.map((t) => ({ t, d: DateTime.fromISO(t.dueAt!).setZone(tz) })).find((x) => x.d >= now);
    const today = now.toISODate()!;
    const list = checklist.filter((h) => !h.archived);
    return {
      remindersToday: open.filter((t) => DateTime.fromISO(t.dueAt!).setZone(tz).hasSame(now, 'day')).length,
      checklistDone: list.filter((h) => h.checkIns.includes(today)).length,
      checklistTotal: list.length,
      nextLabel: next ? `${next.d.toFormat(next.d.hasSame(now, 'day') ? 'HH:mm' : 'ccc HH:mm')} · ${next.t.title}` : null,
    };
  }, [tasks, checklist, tz]);

  return (
    <Screen title="Reminders" subtitle="They ring like an alarm at the time you set">
      <Pressable
        onPress={() => router.push('/reminder-form')}
        accessibilityRole="button"
        style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 12, height: 56, borderRadius: 18, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
      >
        <Text style={{ color: '#06122E', fontSize: 17, fontWeight: '800' }}>+  New reminder</Text>
      </Pressable>
      {isLoading ? (
        <ActivityIndicator color={colors.cyan} style={{ marginTop: 40 }} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          onRefresh={refetch}
          refreshing={isRefetching}
          contentContainerStyle={{ paddingBottom: tabSpace + 32 }}
          ListHeaderComponent={<OrbitHero {...hero} />}
          renderSectionHeader={({ section }) => (
            <Text style={{ color: section.title === 'Missed' ? colors.danger : colors.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginHorizontal: 20, marginTop: 14, marginBottom: 8 }}>{section.title}</Text>
          )}
          renderItem={({ item, section }) => <Row task={item} tz={tz} missed={section.title === 'Missed'} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 40 }}>
              <Text style={{ fontSize: 44 }}>⏰</Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 }}>No reminders yet</Text>
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 6 }}>Tap “New reminder”, fill in what and when, and your phone will ring at that time.</Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}
