/** Human labels and presets for repeat rules (client-side, no rrule dependency). */
const DAYS: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };

export function describeRepeat(rrule: string): string {
  const parts = Object.fromEntries(rrule.replace(/^RRULE:/, '').split(';').map((p) => p.split('=') as [string, string]));
  const n = Number(parts.INTERVAL ?? 1);
  const every = (unit: string) => (n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`);
  switch (parts.FREQ) {
    case 'DAILY':
      return n > 1 ? `Every ${n} days` : 'Daily';
    case 'WEEKLY': {
      const days = parts.BYDAY?.split(',');
      if (days?.join(',') === 'MO,TU,WE,TH,FR') return 'Weekdays';
      if (days?.length) return `${every('week')} on ${days.map((d) => DAYS[d] ?? d).join(', ')}`;
      return n > 1 ? `Every ${n} weeks` : 'Weekly';
    }
    case 'MONTHLY':
      return parts.BYMONTHDAY ? `${every('month')} on day ${parts.BYMONTHDAY}` : n > 1 ? `Every ${n} months` : 'Monthly';
    case 'YEARLY':
      return 'Yearly';
    case 'HOURLY':
      return every('hour');
    default:
      return 'Custom';
  }
}

export const REPEAT_PRESETS = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekdays', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', value: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
  { label: 'Yearly', value: 'FREQ=YEARLY' },
];
