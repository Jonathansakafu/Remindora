import { priorityMeta } from '@remindora/ui/tokens';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Glass, Screen, SectionLabel, styles } from '../src/components/ui';
import { api } from '../src/lib/api';
import { patchTask, refetchTasks, showError, useComplete, useTask, useUpdate } from '../src/lib/queries';
import { useSession } from '../src/lib/session';
import { colors } from '../src/lib/theme';
import { useSystemBottom } from '../src/lib/layout';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: task } = useTask(id);
  if (!task) return <Screen><ActivityIndicator color={colors.cyan} style={{ marginTop: 80 }} /></Screen>;
  return <TaskBody task={task} />;
}

function TaskBody({ task }: { task: TaskDTO }) {
  const systemBottom = useSystemBottom();
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const update = useUpdate();
  const complete = useComplete();
  const qc = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [item, setItem] = useState('');
  useEffect(() => setTitle(task.title), [task.title]);

  const reschedule = (d: DateTime) => update.mutate({ task, patch: { dueAt: d.toUTC().toISO(), allDay: task.allDay || !task.dueAt } });
  const now = DateTime.now().setZone(tz);
  const base = task.dueAt && !task.allDay ? DateTime.fromISO(task.dueAt).setZone(tz) : now.set({ hour: 9, minute: 0 });

  async function sub(fn: () => Promise<TaskDTO>) {
    try {
      patchTask(qc, await fn());
      refetchTasks(qc);
    } catch (e) {
      showError(e);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + systemBottom }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={10}><Text style={{ color: colors.cyan, fontSize: 16 }}>Close</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert('Move to Trash?', task.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await api(`/tasks/${task.id}`, { method: 'DELETE' }).catch(showError); refetchTasks(qc); router.back(); } }])}
          >
            <Text style={{ color: colors.danger, fontSize: 16 }}>Delete</Text>
          </Pressable>
        </View>
        <TextInput value={title} onChangeText={setTitle} onEndEditing={() => title.trim() && title !== task.title && update.mutate({ task, patch: { title: title.trim() } })} multiline style={{ color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 12 }} accessibilityLabel="Task title" />
        <Button label={task.completedAt ? 'Mark as not done' : 'Complete'} variant={task.completedAt ? 'secondary' : 'primary'} onPress={() => complete.mutate({ task, done: !task.completedAt })} />

        <SectionLabel>Priority</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 4 }} accessibilityRole="radiogroup">
          {PRIORITIES.map((p) => (
            <Pressable key={p} accessibilityRole="radio" accessibilityState={{ checked: task.priority === p }} onPress={() => update.mutate({ task, patch: { priority: p } })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: task.priority === p ? priorityMeta[p].color : colors.border, backgroundColor: task.priority === p ? `${priorityMeta[p].color}22` : 'transparent' }}>
              <Text style={{ color: priorityMeta[p].color, fontWeight: '600' }}>{priorityMeta[p].label}</Text>
            </Pressable>
          ))}
        </View>

        <SectionLabel>Due</SectionLabel>
        <Glass>
          <Text style={{ color: colors.text, fontSize: 16 }}>{task.dueAt ? DateTime.fromISO(task.dueAt).setZone(tz).toFormat(task.allDay ? 'cccc d LLLL' : 'cccc d LLLL, HH:mm') : 'No date'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {[['Today', base.set({ year: now.year, ordinal: now.ordinal })], ['Tomorrow', base.set({ year: now.year, ordinal: now.ordinal }).plus({ days: 1 })], ['Next week', base.set({ year: now.year, ordinal: now.ordinal }).plus({ weeks: 1 })]].map(([label, d]) => (
              <Pressable key={label as string} onPress={() => reschedule(d as DateTime)} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(96,233,255,0.12)' }}>
                <Text style={{ color: colors.cyan }}>{label as string}</Text>
              </Pressable>
            ))}
            {task.dueAt ? <Pressable onPress={() => update.mutate({ task, patch: { dueAt: null } })} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: colors.textFaint }}>Clear</Text></Pressable> : null}
          </View>
          {task.recurrence ? <Text style={{ color: colors.textMuted, marginTop: 8 }}>↻ Repeats</Text> : null}
        </Glass>

        <SectionLabel>Checklist</SectionLabel>
        <Glass>
          {task.subtasks.map((s) => (
            <Pressable key={s.id} onPress={() => sub(() => api<TaskDTO>(`/subtasks/${s.id}`, { method: 'PATCH', body: { done: !s.done } }))} accessibilityRole="checkbox" accessibilityState={{ checked: s.done }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: s.done ? colors.success : colors.textFaint, fontSize: 18, width: 26 }}>{s.done ? '☑' : '☐'}</Text>
              <Text style={{ color: s.done ? colors.textFaint : colors.text, textDecorationLine: s.done ? 'line-through' : 'none', flex: 1 }}>{s.title}</Text>
            </Pressable>
          ))}
          <TextInput value={item} onChangeText={setItem} placeholder="Add an item" placeholderTextColor={colors.textFaint} style={[styles.input, { marginTop: 8 }]} onSubmitEditing={() => { if (item.trim()) void sub(() => api<TaskDTO>(`/tasks/${task.id}/subtasks`, { body: { title: item.trim() } })); setItem(''); }} accessibilityLabel="New checklist item" />
        </Glass>

        {task.tags.length ? (<><SectionLabel>Tags</SectionLabel><Text style={{ color: colors.violet, marginHorizontal: 20 }}>{task.tags.map((t) => `#${t}`).join('  ')}</Text></>) : null}
      </ScrollView>
    </Screen>
  );
}
