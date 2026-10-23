import { parseQuickAdd } from '@remindora/core';
import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../lib/api';
import { mutateOrQueue, useSync } from '../lib/offline';
import { refetchTasks, showError } from '../lib/queries';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { styles } from './ui';

/** Natural-language Quick Add with a live preview (parsing runs on-device, so it works offline). */
export function QuickAddBar({ projectId, placeholder = 'Add a task… e.g. “Call mom Sunday 6pm !high”' }: { projectId?: string; placeholder?: string }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { timezone: tz }) : null), [text, tz]);

  async function submit() {
    if (!parsed || busy) return;
    setBusy(true);
    try {
      if (useSync.getState().online) {
        await api<{ task: TaskDTO }>('/tasks/quick-add', { body: { text, projectId } });
      } else {
        await mutateOrQueue({ method: 'POST', path: '/tasks', body: { clientId: Crypto.randomUUID(), title: parsed.title, projectId, priority: parsed.priority ?? 'NONE', tags: parsed.tags, dueAt: parsed.dueAt, allDay: parsed.allDay, recurrence: parsed.recurrence, checklist: [], dependsOn: [] } });
      }
      setText('');
      refetchTasks(qc);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  const chips: string[] = [];
  if (parsed?.dueAt) chips.push(DateTime.fromISO(parsed.dueAt).setZone(tz).toFormat(parsed.allDay ? 'ccc d LLL' : 'ccc d LLL, HH:mm'));
  if (parsed?.dueAt && !parsed.allDay) chips.push(`🔔 reminder at ${DateTime.fromISO(parsed.dueAt).setZone(tz).toFormat('HH:mm')}`);
  if (parsed?.recurrence) chips.push('repeats');
  if (parsed?.priority) chips.push(parsed.priority.toLowerCase());
  for (const t of parsed?.tags ?? []) chips.push(`#${t}`);

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          style={[styles.input, { flex: 1 }]}
          accessibilityLabel="Quick add a task"
        />
        <Pressable onPress={submit} disabled={!parsed || busy} accessibilityRole="button" accessibilityLabel="Add task" style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: parsed ? colors.cyan : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: parsed ? '#06122E' : colors.textFaint, fontSize: 24, fontWeight: '700', marginTop: -2 }}>+</Text>
        </Pressable>
      </View>
      {chips.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }} accessibilityLiveRegion="polite">
          {chips.map((c) => (
            <Text key={c} style={{ color: colors.cyan, fontSize: 12, borderWidth: 1, borderColor: 'rgba(96,233,255,0.3)', backgroundColor: 'rgba(96,233,255,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>{c}</Text>
          ))}
          {parsed && parsed.title !== text.trim() ? <Text style={{ color: colors.textFaint, fontSize: 12, alignSelf: 'center' }}>→ “{parsed.title}”</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
