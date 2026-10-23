/** Alarm sounds a reminder can ring with. Files: web /sounds/<value>.wav, Android res/raw remindora_<value>. */
export const ALARM_SOUNDS = [
  { value: 'alarm', label: 'Alarm clock' },
  { value: 'bell', label: 'Bell' },
  { value: 'chime', label: 'Gentle chime' },
  { value: 'digital', label: 'Digital beep' },
  { value: 'siren', label: 'Siren (urgent)' },
  { value: 'silent', label: 'Silent (vibrate only)' },
] as const;

export type AlarmSound = (typeof ALARM_SOUNDS)[number]['value'];
export const DEFAULT_ALARM_SOUND: AlarmSound = 'alarm';
export const ALARM_SOUND_VALUES = ALARM_SOUNDS.map((s) => s.value) as [AlarmSound, ...AlarmSound[]];

export function normalizeAlarmSound(v: string | null | undefined): AlarmSound {
  return (ALARM_SOUND_VALUES as readonly string[]).includes(v ?? '') ? (v as AlarmSound) : DEFAULT_ALARM_SOUND;
}

export function alarmSoundLabel(v: string | null | undefined): string {
  return ALARM_SOUNDS.find((s) => s.value === normalizeAlarmSound(v))!.label;
}
