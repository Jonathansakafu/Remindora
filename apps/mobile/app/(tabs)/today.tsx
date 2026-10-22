import { DateTime } from 'luxon';
import { TaskList } from '../../src/components/TaskList';
import { Screen } from '../../src/components/ui';
import { useSession } from '../../src/lib/session';

export default function Today() {
  const tz = useSession((s) => s.user?.timezone ?? 'UTC');
  return (
    <Screen title="Today" subtitle={DateTime.now().setZone(tz).toFormat('cccc, d LLLL')}>
      <TaskList view="today" emptyTitle="Nothing due today. Enjoy the clear sky." />
    </Screen>
  );
}
