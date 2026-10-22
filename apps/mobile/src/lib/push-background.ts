import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

/**
 * Background handler for data-only pushes: when a reminder is acknowledged on another
 * device the server sends { type: 'dismiss' }, and we clear our tray copy so the same
 * alert is never handled twice. Runs headlessly even if the app isn't open.
 */
export const BACKGROUND_NOTIFICATION_TASK = 'remindora-background-notification';

TaskManager.defineTask<{ data?: Record<string, unknown> }>(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const payload = ((data.data as Record<string, unknown> | undefined) ?? (data as Record<string, unknown>)) as { type?: string; notificationId?: string; reminderId?: string };
  if (payload.type !== 'dismiss') return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const n of presented) {
    const d = n.request.content.data as { notificationId?: string; reminderId?: string } | undefined;
    if ((payload.notificationId && d?.notificationId === payload.notificationId) || (payload.reminderId && d?.reminderId === payload.reminderId)) {
      await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  }
});

void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined);
