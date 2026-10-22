// Entry: register the Android widget task handler, then boot Expo Router.
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task-handler';
import './src/lib/push-background';

registerWidgetTaskHandler(widgetTaskHandler);

import 'expo-router/entry';
