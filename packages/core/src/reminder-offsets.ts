/** "Remind me" choices in the reminder form: minutes before the due time (0 = on time). */
export const REMIND_PRESETS = [
  { minutes: 0, label: 'On time' },
  { minutes: 5, label: '5 min early' },
  { minutes: 15, label: '15 min early' },
  { minutes: 30, label: '30 min early' },
  { minutes: 60, label: '1 hour early' },
  { minutes: 120, label: '2 hours early' },
  { minutes: 1440, label: '1 day early' },
] as const;

export const CUSTOM_UNITS = [
  { value: 'minutes', label: 'minutes', factor: 1 },
  { value: 'hours', label: 'hours', factor: 60 },
  { value: 'days', label: 'days', factor: 1440 },
] as const;
export type CustomUnit = (typeof CUSTOM_UNITS)[number]['value'];

/** Longest early reminder allowed (matches the API limit of 30 days). */
export const MAX_OFFSET_MINUTES = 60 * 24 * 30;

export function customOffset(amount: number, unit: CustomUnit): number | null {
  const factor = CUSTOM_UNITS.find((u) => u.value === unit)!.factor;
  const m = Math.round(amount * factor);
  return Number.isFinite(m) && m > 0 && m <= MAX_OFFSET_MINUTES ? m : null;
}

/** 0 → "On time", 75 → "1 h 15 min early", 4335 → "3 days 15 min early". */
export function offsetLabel(minutes: number): string {
  if (minutes <= 0) return 'On time';
  const preset = REMIND_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [days ? `${days} day${days === 1 ? '' : 's'}` : '', hours ? `${hours} h` : '', mins ? `${mins} min` : ''].filter(Boolean);
  return `${parts.join(' ')} early`;
}

/** Live countdown text: "in 2 h 15 min", "in 3 days", "now", "5 min ago". */
export function countdownLabel(target: Date, now: Date = new Date()): string {
  const diff = Math.round((target.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(diff);
  if (abs < 1) return 'now';
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  const text = days >= 2 ? `${days} days` : days === 1 ? `1 day${hours ? ` ${hours} h` : ''}` : hours ? `${hours} h${mins ? ` ${mins} min` : ''}` : `${mins} min`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
