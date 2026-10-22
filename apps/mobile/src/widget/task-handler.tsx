import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { WIDGET_KEY, type WidgetTask } from '../lib/widget-data';
import { TodayWidget } from './TodayWidget';

/** Renders the widget from the last data the app saved (works when the app isn't running). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== 'TodayWidget') return;
  if (props.widgetAction === 'WIDGET_DELETED') return;
  const saved = JSON.parse((await AsyncStorage.getItem(WIDGET_KEY)) ?? '{"tasks":[],"total":0}') as { tasks: WidgetTask[]; total: number };
  props.renderWidget(<TodayWidget tasks={saved.tasks} total={saved.total} />);
}
