import { DateTime } from 'luxon';

/** All API dates are UTC; render in the user's selected timezone. */
export function inZone(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
}

export function dueLabel(iso: string | null, allDay: boolean, tz: string, now = DateTime.now().setZone(tz)): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' } | null {
  if (!iso) return null;
  const d = inZone(iso, tz);
  const days = Math.round(d.startOf('day').diff(now.startOf('day'), 'days').days);
  const time = allDay ? '' : ` ${d.toFormat('HH:mm')}`;
  const overdue = allDay ? days < 0 : d < now;
  let text: string;
  if (days === 0) text = `Today${time}`;
  else if (days === 1) text = `Tomorrow${time}`;
  else if (days === -1) text = `Yesterday${time}`;
  else if (days > 1 && days < 7) text = `${d.toFormat('cccc')}${time}`;
  else text = `${d.toFormat(d.year === now.year ? 'd LLL' : 'd LLL yyyy')}${time}`;
  return { text, tone: overdue ? 'overdue' : days === 0 ? 'today' : days <= 2 ? 'soon' : 'later' };
}

export function toLocalInput(iso: string | null, tz: string, allDay: boolean) {
  if (!iso) return '';
  const d = inZone(iso, tz);
  return allDay ? d.toISODate()! : d.toFormat("yyyy-LL-dd'T'HH:mm");
}

export function fromLocalInput(value: string, tz: string): { iso: string | null; allDay: boolean } {
  if (!value) return { iso: null, allDay: false };
  const allDay = !value.includes('T');
  const d = DateTime.fromISO(value, { zone: tz });
  return { iso: d.isValid ? d.toUTC().toISO() : null, allDay };
}

export function relative(iso: string) {
  return DateTime.fromISO(iso).toRelative({ style: 'short' }) ?? '';
}
