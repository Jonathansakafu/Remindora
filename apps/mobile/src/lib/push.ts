import { ANDROID_CHANNELS, REMINDER_CATEGORY } from '@remindora/notifications/dist/android';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Android push setup. Channels map to priorities; users can tune sound/vibration/DND
 * per channel in system settings and Android enforces it. Only "Critical" asks to
 * bypass Do Not Disturb, and only if the user grants notification-policy access.
 */
const IMPORTANCE = {
  MAX: Notifications.AndroidImportance.MAX,
  HIGH: Notifications.AndroidImportance.HIGH,
  DEFAULT: Notifications.AndroidImportance.DEFAULT,
  LOW: Notifications.AndroidImportance.LOW,
} as const;

export async function setupChannelsAndActions() {
  if (Platform.OS !== 'android') return;
  for (const c of Object.values(ANDROID_CHANNELS)) {
    await Notifications.setNotificationChannelAsync(c.id, {
      name: c.name,
      importance: IMPORTANCE[c.importance],
      bypassDnd: c.bypassDnd,
      enableVibrate: c.vibrate,
      vibrationPattern: c.vibrate ? [0, 250, 150, 250] : undefined,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      lightColor: '#60E9FF',
    });
  }
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: 'complete', buttonTitle: 'Complete', options: { opensAppToForeground: false } },
    { identifier: 'snooze', buttonTitle: 'Snooze 10m', options: { opensAppToForeground: false } },
    { identifier: 'stop', buttonTitle: 'Stop reminders', options: { opensAppToForeground: false, isDestructive: true } },
  ]);
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = n.request.content.data as { priority?: string; type?: string };
    const loud = data.priority === 'CRITICAL' || data.priority === 'HIGH';
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: loud, shouldSetBadge: true };
  },
});

/** Requests permission (Android 13+ runtime prompt) and registers this device's push token with the API. */
export async function registerForPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!Device.isDevice) return 'unavailable';
  await setupChannelsAndActions();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  try {
    // Native FCM token when google-services.json is configured; otherwise the Expo push service.
    const device = await Notifications.getDevicePushTokenAsync();
    await api('/devices/current/push', { body: { provider: 'fcm', token: String(device.data) } });
  } catch {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const expo = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api('/devices/current/push', { body: { provider: 'expo', token: expo.data } });
  }
  return 'granted';
}

/** Handles taps on notification action buttons (works with the app in the background). */
export async function handleResponse(response: Notifications.NotificationResponse, openTask: (id: string) => void) {
  const data = response.notification.request.content.data as { notificationId?: string; taskId?: string };
  const action = response.actionIdentifier;
  if (data.notificationId && (action === 'complete' || action === 'snooze' || action === 'stop')) {
    await api(`/notifications/${data.notificationId}/action`, { body: action === 'snooze' ? { action, snoozeMinutes: 10 } : { action } }).catch(() => undefined);
    await Notifications.dismissNotificationAsync(response.notification.request.identifier);
    return;
  }
  if (data.notificationId) void api(`/notifications/${data.notificationId}/read`, { method: 'POST' }).catch(() => undefined);
  if (data.taskId) openTask(data.taskId);
}

/** Battery optimisation can delay reminders on some Android OEMs; let the user exempt Remindora. */
export function openBatterySettings() {
  return IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
}

/** Lets critical reminders break through Do Not Disturb (user must grant policy access). */
export function openDndAccessSettings() {
  return IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.NOTIFICATION_POLICY_ACCESS_SETTINGS);
}

export function openChannelSettings() {
  return IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, { extra: { 'android.provider.extra.APP_PACKAGE': 'app.remindora.mobile' } });
}
