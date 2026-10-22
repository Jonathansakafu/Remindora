import { decryptSecret, encryptSecret } from '@remindora/auth';
import { refreshIcsSubscription } from '@remindora/database';
import { safeFetch, type WebhookJob } from '@remindora/notifications';
import { createHmac } from 'node:crypto';
import type { Deps } from '../deps';

/**
 * Outbound integrations: signed Zapier webhooks, Slack incoming webhooks,
 * Notion page creation, and calendar imports (ICS, Google, Outlook).
 */

function secretFor(d: Deps, userId: string, provider: string, enc: string | null) {
  return enc ? decryptSecret(d.keys.encryption, enc, `integration:${userId}:${provider}`) : null;
}

export async function deliverWebhook(d: Deps, job: WebhookJob) {
  const rows = await d.prisma.integration.findMany({ where: { userId: job.userId, status: 'connected', provider: { in: ['zapier', 'slack', 'notion'] } } });
  for (const row of rows) {
    const config = row.config as { url?: string; events?: string[]; databaseId?: string | null };
    try {
      if (row.provider === 'zapier' && config.url && config.events?.includes(job.event)) {
        const body = JSON.stringify({ event: job.event, createdAt: new Date().toISOString(), data: job.payload });
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', secretFor(d, row.userId, 'zapier', row.credentialsEnc)!).update(`${t}.${body}`).digest('hex');
        const res = await safeFetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Remindora-Event': job.event, 'X-Remindora-Signature': `t=${t},v1=${sig}` }, body, maxBytes: 64_000 });
        if (res.status >= 400) throw new Error(`Webhook responded ${res.status}`);
      }
      if (row.provider === 'slack' && config.url && job.event === 'alert.critical') {
        const p = job.payload as { title: string; body: string; link: string };
        await safeFetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `:rotating_light: *${p.title}*\n${p.body}\n<${p.link}|Open in Remindora>` }), maxBytes: 16_000 });
      }
      if (row.provider === 'slack' && config.url && job.event === 'digest') {
        const p = job.payload as { heading: string; lines: string[] };
        await safeFetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${p.heading}*\n${p.lines.map((l) => `• ${l}`).join('\n')}` }), maxBytes: 16_000 });
      }
      if (row.provider === 'notion' && config.databaseId && job.event === 'task.created') {
        const creds = JSON.parse(secretFor(d, row.userId, 'notion', row.credentialsEnc) ?? '{}') as { access_token?: string };
        const task = (job.payload as { task: { title: string; dueAt: string | null; priority: string } }).task;
        const res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.access_token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({ parent: { database_id: config.databaseId }, properties: { Name: { title: [{ text: { content: task.title } }] } } }),
        });
        if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      }
      await d.prisma.integration.update({ where: { id: row.id }, data: { lastSyncAt: new Date(), lastError: null } });
    } catch (e) {
      await d.prisma.integration.update({ where: { id: row.id }, data: { lastError: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }
}

async function oauthToken(d: Deps, row: { id: string; userId: string; provider: string; credentialsEnc: string | null }) {
  const creds = JSON.parse(secretFor(d, row.userId, row.provider, row.credentialsEnc) ?? '{}') as { access_token: string; refresh_token: string | null; expires_at: number | null };
  if (!creds.expires_at || creds.expires_at > Date.now() + 60_000 || !creds.refresh_token) return creds.access_token;
  const google = row.provider === 'google_calendar';
  const res = await fetch(google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: String(google ? d.env.GOOGLE_CLIENT_ID : d.env.MICROSOFT_CLIENT_ID),
      client_secret: String(google ? d.env.GOOGLE_CLIENT_SECRET : d.env.MICROSOFT_CLIENT_SECRET),
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const next = { access_token: t.access_token, refresh_token: t.refresh_token ?? creds.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  await d.prisma.integration.update({ where: { id: row.id }, data: { credentialsEnc: encryptSecret(d.keys.encryption, JSON.stringify(next), `integration:${row.userId}:${row.provider}`) } });
  return next.access_token;
}

/** Imports events from connected Google/Outlook calendars into a managed subscription row. */
async function importProviderCalendar(d: Deps, row: { id: string; userId: string; provider: string; credentialsEnc: string | null }) {
  const token = await oauthToken(d, row);
  const from = new Date(Date.now() - 30 * 86_400_000);
  const to = new Date(Date.now() + 180 * 86_400_000);
  type Ev = { uid: string; title: string; startAt: Date; endAt: Date; allDay: boolean; location: string | null };
  const events: Ev[] = [];
  if (row.provider === 'google_calendar') {
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' })}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Calendar responded ${res.status}`);
    const body = (await res.json()) as { items: Array<{ id: string; summary?: string; status?: string; location?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }> };
    for (const e of body.items ?? []) {
      if (e.status === 'cancelled') continue;
      const allDay = !e.start.dateTime;
      events.push({ uid: e.id, title: e.summary ?? '(no title)', startAt: new Date(e.start.dateTime ?? `${e.start.date}T00:00:00Z`), endAt: new Date(e.end.dateTime ?? `${e.end.date}T00:00:00Z`), allDay, location: e.location ?? null });
    }
  } else {
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: '1000' })}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
    if (!res.ok) throw new Error(`Outlook responded ${res.status}`);
    const body = (await res.json()) as { value: Array<{ id: string; subject?: string; isAllDay: boolean; isCancelled?: boolean; location?: { displayName?: string }; start: { dateTime: string }; end: { dateTime: string } }> };
    for (const e of body.value ?? []) {
      if (e.isCancelled) continue;
      events.push({ uid: e.id, title: e.subject ?? '(no title)', startAt: new Date(`${e.start.dateTime}Z`), endAt: new Date(`${e.end.dateTime}Z`), allDay: e.isAllDay, location: e.location?.displayName ?? null });
    }
  }
  const marker = `integration:${row.provider}`;
  const sub =
    (await d.prisma.calendarSubscription.findFirst({ where: { userId: row.userId, url: marker } })) ??
    (await d.prisma.calendarSubscription.create({ data: { userId: row.userId, url: marker, name: row.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook', color: row.provider === 'google_calendar' ? '#60E9FF' : '#A58CFF' } }));
  await d.prisma.$transaction([
    d.prisma.externalEvent.deleteMany({ where: { subscriptionId: sub.id } }),
    d.prisma.externalEvent.createMany({ data: events.map((e) => ({ ...e, subscriptionId: sub.id })), skipDuplicates: true }),
    d.prisma.calendarSubscription.update({ where: { id: sub.id }, data: { lastFetchedAt: new Date(), lastError: null } }),
    d.prisma.integration.update({ where: { id: row.id }, data: { lastSyncAt: new Date(), lastError: null } }),
  ]);
  return events.length;
}

export async function refreshCalendars(d: Deps) {
  const stale = await d.prisma.calendarSubscription.findMany({
    where: { url: { not: { startsWith: 'integration:' } }, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - 3_600_000) } }] },
    select: { id: true },
    take: 200,
  });
  for (const s of stale) await refreshIcsSubscription(d.prisma, s.id, (url) => safeFetch(url, { headers: { Accept: 'text/calendar' } }));
  const connected = await d.prisma.integration.findMany({ where: { status: 'connected', provider: { in: ['google_calendar', 'outlook_calendar'] } } });
  for (const row of connected) {
    try {
      await importProviderCalendar(d, row);
    } catch (e) {
      await d.prisma.integration.update({ where: { id: row.id }, data: { lastError: (e as Error).message.slice(0, 300) } });
    }
  }
  return { ics: stale.length, providers: connected.length };
}
