/** Simple repeat choices for the reminder form, shared by web, desktop and Android. */
export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Never', rrule: null },
  { value: 'daily', label: 'Every day', rrule: 'FREQ=DAILY' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { value: 'weekly', label: 'Every week', rrule: 'FREQ=WEEKLY' },
  { value: 'monthly', label: 'Every month', rrule: 'FREQ=MONTHLY' },
] as const;

export type RepeatValue = (typeof REPEAT_OPTIONS)[number]['value'];

export function repeatFromRrule(rrule: string | null | undefined): RepeatValue {
  if (!rrule) return 'none';
  const r = rrule.toUpperCase();
  if (r.startsWith('FREQ=DAILY')) return 'daily';
  if (r.includes('BYDAY=MO,TU,WE,TH,FR')) return 'weekdays';
  if (r.startsWith('FREQ=WEEKLY')) return 'weekly';
  if (r.startsWith('FREQ=MONTHLY')) return 'monthly';
  return 'none';
}

export function repeatLabel(rrule: string | null | undefined): string | null {
  const v = repeatFromRrule(rrule);
  return v === 'none' ? null : REPEAT_OPTIONS.find((o) => o.value === v)!.label;
}

export function rruleFor(value: RepeatValue): string | null {
  return REPEAT_OPTIONS.find((o) => o.value === value)!.rrule;
}
