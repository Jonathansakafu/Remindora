import type { TaskDTO } from '@remindora/types';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import { useTasks } from '../lib/queries';
import { useSync } from '../lib/offline';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { QuickAddBar } from './QuickAddBar';
import { TaskRow } from './TaskRow';
import { Empty, SectionLabel } from './ui';

export function TaskList({ view, emptyTitle, group = true }: { view: string; emptyTitle: string; group?: boolean }) {
  const { data = [], isFetching, refetch } = useTasks({ view });
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const { online, pending } = useSync();
  const qc = useQueryClient();
  const sections = useMemo(() => {
    if (!group) return [{ title: '', data }];
    const now = DateTime.now().setZone(tz);
    const overdue: TaskDTO[] = [];
    const rest: TaskDTO[] = [];
    for (const t of data) {
      const d = t.dueAt ? DateTime.fromISO(t.dueAt).setZone(tz) : null;
      if (d && !t.completedAt && (t.allDay ? d.startOf('day') < now.startOf('day') : d < now)) overdue.push(t);
      else rest.push(t);
    }
    return [...(overdue.length ? [{ title: 'Overdue', data: overdue }] : []), { title: overdue.length ? 'Today' : '', data: rest }].filter((s) => s.data.length);
  }, [data, tz, group]);

  return (
    <View style={{ flex: 1 }}>
      {!online ? <Text style={{ color: colors.amber, fontSize: 12, marginHorizontal: 20 }}>Offline{pending ? ` · ${pending} change${pending > 1 ? 's' : ''} queued` : ''} — will sync automatically</Text> : null}
      <QuickAddBar />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskRow task={item} />}
        renderSectionHeader={({ section }) => (section.title ? <SectionLabel color={section.title === 'Overdue' ? colors.danger : colors.cyan}>{section.title}</SectionLabel> : null)}
        ListEmptyComponent={<Empty title={emptyTitle} />}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => (void refetch(), void qc.invalidateQueries({ queryKey: ['notifications'] }))} tintColor={colors.cyan} />}
        contentContainerStyle={{ paddingBottom: 96 }}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}
