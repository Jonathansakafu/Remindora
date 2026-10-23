import type { Priority } from '@remindora/types';

/**
 * Android notification channel mapping. Channels are created by the mobile app;
 * users can tune them in system settings, which Android then enforces (sound,
 * DND bypass, badge). Only `critical` requests DND bypass, and Android only honours
 * it if the user granted notification-policy access.
 */
export const ANDROID_CHANNELS = {
  /** Every task reminder rings here like an alarm clock (own sound, max importance, bypasses DND). */
  alarm: { id: 'remindora-alarm', name: 'Alarms', importance: 'MAX', bypassDnd: true, vibrate: true },
  critical: { id: 'remindora-critical', name: 'Critical reminders', importance: 'MAX', bypassDnd: true, vibrate: true },
  high: { id: 'remindora-high', name: 'High priority reminders', importance: 'HIGH', bypassDnd: false, vibrate: true },
  default: { id: 'remindora-default', name: 'Reminders', importance: 'DEFAULT', bypassDnd: false, vibrate: false },
  quiet: { id: 'remindora-quiet', name: 'Low priority & digests', importance: 'LOW', bypassDnd: false, vibrate: false },
} as const;

export function androidChannelFor(priority: Priority): (typeof ANDROID_CHANNELS)[keyof typeof ANDROID_CHANNELS] {
  switch (priority) {
    case 'CRITICAL':
      return ANDROID_CHANNELS.critical;
    case 'HIGH':
      return ANDROID_CHANNELS.high;
    case 'MEDIUM':
      return ANDROID_CHANNELS.default;
    default:
      return ANDROID_CHANNELS.quiet;
  }
}

/** Bundled Android raw resource (apps/mobile/assets/sounds/remindora_alarm.wav). */
export const ALARM_SOUND = 'remindora_alarm';

/** Reminders ring as alarms; everything else (digests, invites, approvals) follows priority. */
export function androidChannelForNotification(kind: string, priority: Priority) {
  return kind === 'REMINDER' ? ANDROID_CHANNELS.alarm : androidChannelFor(priority);
}

/** Notification category id registered on devices, carrying the one-tap actions. */
export const REMINDER_CATEGORY = 'remindora.reminder';
export const REMINDER_ACTIONS = ['complete', 'snooze', 'stop'] as const;
