import type { Priority } from '@remindora/types';

/**
 * Android notification channel mapping. Channels are created by the mobile app;
 * users can tune them in system settings, which Android then enforces (sound,
 * DND bypass, badge). Only `critical` requests DND bypass, and Android only honours
 * it if the user granted notification-policy access.
 */
export const ANDROID_CHANNELS = {
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

/** Notification category id registered on devices, carrying the one-tap actions. */
export const REMINDER_CATEGORY = 'remindora.reminder';
export const REMINDER_ACTIONS = ['complete', 'snooze', 'stop'] as const;
