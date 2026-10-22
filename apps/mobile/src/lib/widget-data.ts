import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TaskDTO } from '@remindora/types';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { TodayWidget } from '../widget/TodayWidget';

export const WIDGET_KEY = 'remindora.widget.today';

export interface WidgetTask {
  id: string;
  title: string;
  priority: string;
  due: string | null;
}

/** Saves today's top tasks for the home-screen widget and asks Android to redraw it. */
export async function pushTodayToWidget(tasks: TaskDTO[]) {
  if (Platform.OS !== 'android') return;
  const open = tasks.filter((t) => !t.completedAt);
  const top: WidgetTask[] = open.slice(0, 5).map((t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.dueAt && !t.allDay ? new Date(t.dueAt).toTimeString().slice(0, 5) : null }));
  await AsyncStorage.setItem(WIDGET_KEY, JSON.stringify({ tasks: top, total: open.length, at: Date.now() }));
  await requestWidgetUpdate({ widgetName: 'TodayWidget', renderWidget: () => TodayWidget({ tasks: top, total: open.length }) }).catch(() => undefined);
}
