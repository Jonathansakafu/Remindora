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

/** Bundled Android raw resource for the default alarm (apps/mobile/assets/sounds/remindora_alarm.wav). */
export const ALARM_SOUND = 'remindora_alarm';

/**
 * Android fixes a channel's sound when it's created, so each reminder sound gets its own
 * alarm channel. `raw` is the bundled res/raw name (null = vibrate only).
 */
export const ALARM_SOUND_CHANNELS = {
  alarm: { id: ANDROID_CHANNELS.alarm.id, name: 'Alarms — Alarm clock', raw: 'remindora_alarm' },
  bell: { id: 'remindora-alarm-bell', name: 'Alarms — Bell', raw: 'remindora_bell' },
  chime: { id: 'remindora-alarm-chime', name: 'Alarms — Gentle chime', raw: 'remindora_chime' },
  digital: { id: 'remindora-alarm-digital', name: 'Alarms — Digital beep', raw: 'remindora_digital' },
  siren: { id: 'remindora-alarm-siren', name: 'Alarms — Siren', raw: 'remindora_siren' },
  silent: { id: 'remindora-alarm-silent', name: 'Alarms — Vibrate only', raw: null },
} as const;

export type AlarmSoundKey = keyof typeof ALARM_SOUND_CHANNELS;

export function alarmChannelFor(sound: unknown) {
  return ALARM_SOUND_CHANNELS[(typeof sound === 'string' && sound in ALARM_SOUND_CHANNELS ? sound : 'alarm') as AlarmSoundKey];
}

const ALARM_CHANNEL_IDS = new Set<string>(Object.values(ALARM_SOUND_CHANNELS).map((c) => c.id));
export function isAlarmChannel(id: string) {
  return ALARM_CHANNEL_IDS.has(id);
}

/** Reminders ring as alarms (with their chosen sound); everything else follows priority. */
export function androidChannelForNotification(kind: string, priority: Priority, sound?: unknown) {
  return kind === 'REMINDER' ? alarmChannelFor(sound) : androidChannelFor(priority);
}

/** Notification category id registered on devices, carrying the one-tap actions. */
export const REMINDER_CATEGORY = 'remindora.reminder';
export const REMINDER_ACTIONS = ['complete', 'snooze', 'stop'] as const;
