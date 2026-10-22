import { TaskList } from '../../src/components/TaskList';
import { Screen } from '../../src/components/ui';

export default function Inbox() {
  return (
    <Screen title="Inbox" subtitle="Capture now, sort later">
      <TaskList view="inbox" emptyTitle="Inbox zero ✨" group={false} />
    </Screen>
  );
}
