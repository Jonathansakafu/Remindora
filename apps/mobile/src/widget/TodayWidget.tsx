'use no memo';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetTask } from '../lib/widget-data';

const COLORS: Record<string, `#${string}`> = { CRITICAL: '#FF7A93', HIGH: '#FFBC5C', MEDIUM: '#60E9FF', LOW: '#A58CFF', NONE: '#7D92B4' };

/** Android home-screen widget: today's top tasks; tap opens the task (deep link). */
export function TodayWidget({ tasks, total }: { tasks: WidgetTask[]; total: number }) {
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#0B1330', borderRadius: 22, padding: 14, flexDirection: 'column' }} clickAction="OPEN_URI" clickActionData={{ uri: 'remindora://today' }}>
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', marginBottom: 8 }}>
        <TextWidget text="Today" style={{ fontSize: 16, fontWeight: '700', color: '#E8F4FF' }} />
        <TextWidget text={total ? `${total} open` : 'All clear'} style={{ fontSize: 12, color: '#A6BAD8' }} />
      </FlexWidget>
      {tasks.length === 0 ? (
        <TextWidget text="Nothing due today ✨" style={{ fontSize: 13, color: '#A6BAD8' }} />
      ) : (
        tasks.map((t) => (
          <FlexWidget key={t.id} style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', paddingVertical: 4 }} clickAction="OPEN_URI" clickActionData={{ uri: `remindora://task?id=${t.id}` }}>
            <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS[t.priority] ?? '#7D92B4', marginRight: 8 }} />
            <FlexWidget style={{ flex: 1 }}>
              <TextWidget text={t.title} maxLines={1} truncate="END" style={{ fontSize: 13, color: '#E8F4FF' }} />
            </FlexWidget>
            {t.due ? <TextWidget text={t.due} style={{ fontSize: 11, color: '#60E9FF', marginLeft: 6 }} /> : null}
          </FlexWidget>
        ))
      )}
    </FlexWidget>
  );
}
