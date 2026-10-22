import { DateTime } from 'luxon';
import { occurrencesBetween } from './recurrence';

/**
 * Minimal iCalendar (RFC 5545) VEVENT reader for read-only calendar
 * subscriptions: line unfolding, UTC / TZID / floating / all-day dates,
 * and RRULE expansion within a window. Cancelled events are skipped.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
}

interface Prop {
  value: string;
  params: Record<string, string>;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): [string, Prop] | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v] = p.split('=');
    if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return [name!.toUpperCase(), { value: line.slice(colon + 1), params }];
}

function unescapeText(v: string) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}

function parseDate(p: Prop, defaultTz: string): { date: Date; allDay: boolean; zone: string } | null {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const d = DateTime.fromFormat(v.slice(0, 8), 'yyyyMMdd', { zone: defaultTz });
    return d.isValid ? { date: d.toJSDate(), allDay: true, zone: defaultTz } : null;
  }
  const m = /^(\d{8}T\d{6})(Z?)$/.exec(v);
  if (!m) return null;
  const zone = m[2] ? 'utc' : (p.params.TZID ?? defaultTz);
  let d = DateTime.fromFormat(m[1]!, "yyyyMMdd'T'HHmmss", { zone });
  let used = zone;
  if (!d.isValid) {
    used = defaultTz;
    d = DateTime.fromFormat(m[1]!, "yyyyMMdd'T'HHmmss", { zone: defaultTz });
  }
  return d.isValid ? { date: d.toJSDate(), allDay: false, zone: used } : null;
}

export function parseIcs(text: string, window: { from: Date; to: Date }, defaultTz = 'UTC', maxEvents = 5000): IcsEvent[] {
  const out: IcsEvent[] = [];
  let current: Map<string, Prop> | null = null;
  let exdates: Date[] = [];

  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map();
      exdates = [];
      continue;
    }
    if (line === 'END:VEVENT' && current) {
      const ev = current;
      current = null;
      if (ev.get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
      const start = ev.get('DTSTART') ? parseDate(ev.get('DTSTART')!, defaultTz) : null;
      if (!start) continue;
      const endProp = ev.get('DTEND');
      const end = endProp ? parseDate(endProp, defaultTz) : null;
      const duration = end ? end.date.getTime() - start.date.getTime() : start.allDay ? 86_400_000 : 3_600_000;
      const base = {
        uid: ev.get('UID')?.value ?? `${start.date.toISOString()}-${out.length}`,
        title: unescapeText(ev.get('SUMMARY')?.value ?? '(no title)'),
        allDay: start.allDay,
        location: ev.get('LOCATION') ? unescapeText(ev.get('LOCATION')!.value) : null,
      };
      const rrule = ev.get('RRULE')?.value;
      if (rrule) {
        try {
          // Expand in the event's own timezone so wall-clock time survives DST.
          const excluded = new Set(exdates.map((d) => d.getTime()));
          const occs = occurrencesBetween({ rrule, dtstart: start.date, timezone: start.zone }, new Date(window.from.getTime() - duration), window.to, maxEvents);
          for (const occ of occs) {
            if (excluded.has(occ.getTime())) continue;
            out.push({ ...base, startAt: occ, endAt: new Date(occ.getTime() + duration) });
            if (out.length >= maxEvents) return out;
          }
        } catch {
          // Unsupported rule: fall through to the single instance.
        }
        continue;
      }
      if (start.date <= window.to && start.date.getTime() + duration >= window.from.getTime()) {
        out.push({ ...base, startAt: start.date, endAt: new Date(start.date.getTime() + duration) });
        if (out.length >= maxEvents) return out;
      }
      continue;
    }
    if (current) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      const [name, prop] = parsed;
      if (name === 'EXDATE') {
        for (const part of prop.value.split(',')) {
          const d = parseDate({ value: part, params: prop.params }, defaultTz);
          if (d) exdates.push(d.date);
        }
      } else if (!current.has(name)) {
        current.set(name, prop);
      }
    }
  }
  return out;
}
