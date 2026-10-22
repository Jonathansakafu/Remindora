import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { TaskList } from '../src/components/TaskList';
import { Screen } from '../src/components/ui';
import { colors } from '../src/lib/theme';

export default function Upcoming() {
  return (
    <Screen title="Upcoming" subtitle="Next 7 days" right={<Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={{ color: colors.cyan }}>Done</Text></Pressable>}>
      <TaskList view="upcoming" emptyTitle="The week ahead is open." group={false} />
    </Screen>
  );
}
