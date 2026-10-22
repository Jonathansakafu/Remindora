import type { TaskDTO } from '@remindora/types';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useComplete } from '../lib/queries';
import { useSession } from '../lib/session';
import { colors, priorityMeta } from '../lib/theme';

function dueText(t: TaskDTO, tz: string) {
  if (!t.dueAt) return null;
  const d = DateTime.fromISO(t.dueAt).setZone(tz);
  const now = DateTime.now().setZone(tz);
  const days = Math.round(d.startOf('day').diff(now.startOf('day'), 'days').days);
  const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : d.toFormat('ccc d LLL');
  const overdue = !t.completedAt && (t.allDay ? days < 0 : d < now);
  return { text: t.allDay ? label : `${label} ${d.toFormat('HH:mm')}`, overdue };
}

export function TaskRow({ task }: { task: TaskDTO }) {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  const complete = useComplete();
  const [reduced, setReduced] = useState(false);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const done = !!task.completedAt;
  const meta = priorityMeta[task.priority as keyof typeof priorityMeta];
  const due = dueText(task, tz);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
  }, []);

  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));

  function toggle() {
    void Haptics.impactAsync(done ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    if (!done && !reduced) {
      scale.value = withSequence(withSpring(1.25, { damping: 8 }), withSpring(1));
      lift.value = withSequence(withTiming(-3, { duration: 120 }), withTiming(0, { duration: 180 }));
    }
    complete.mutate({ task, done: !done });
  }

  return (
    <Animated.View style={rowStyle}>
      <Pressable
        onPress={() => router.push({ pathname: '/task', params: { id: task.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}${due ? `, due ${due.text}` : ''}, ${meta.label} priority`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 20, backgroundColor: pressed ? 'rgba(255,255,255,0.04)' : 'transparent', opacity: done ? 0.55 : 1 })}
      >
        <Pressable onPress={toggle} hitSlop={12} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`Complete ${task.title}`}>
          <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.8, borderColor: meta.color, backgroundColor: done ? meta.color : `${meta.color}1A`, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, checkStyle]}>
            {done ? <Text style={{ color: '#06122E', fontSize: 13, fontWeight: '900' }}>✓</Text> : null}
          </Animated.View>
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: colors.text, fontSize: 15.5, textDecorationLine: done ? 'line-through' : 'none' }} numberOfLines={2}>
            {task.title}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 3, gap: 10 }}>
            {due ? <Text style={{ color: due.overdue ? colors.danger : colors.cyan, fontSize: 12, fontWeight: '600' }}>{due.text}</Text> : null}
            {task.recurrence ? <Text style={{ color: colors.textFaint, fontSize: 12 }}>↻</Text> : null}
            {task.subtasks.length ? <Text style={{ color: colors.textFaint, fontSize: 12 }}>☑ {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length}</Text> : null}
            {task.tags.map((t) => (
              <Text key={t} style={{ color: colors.violet, fontSize: 12 }}>#{t}</Text>
            ))}
          </View>
        </View>
        {task.priority !== 'NONE' ? <Text style={{ color: meta.color, fontSize: 11, fontWeight: '800', marginLeft: 8 }}>{meta.short}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}
