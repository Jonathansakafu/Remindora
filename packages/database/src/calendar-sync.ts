import { parseIcs } from '@remindora/core';
import type { PrismaClient } from '@prisma/client';

/** Refreshes one ICS subscription: fetch, parse a −30/+180 day window, replace cached events. */
export async function refreshIcsSubscription(prisma: PrismaClient, subscriptionId: string, fetchText: (url: string) => Promise<{ status: number; text: string }>) {
  const sub = await prisma.calendarSubscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { user: { select: { timezone: true } } } });
  try {
    const res = await fetchText(sub.url);
    if (res.status >= 400) throw new Error(`Calendar server responded ${res.status}`);
    if (!res.text.includes('BEGIN:VCALENDAR')) throw new Error('That URL is not an iCalendar feed');
    const from = new Date(Date.now() - 30 * 86_400_000);
    const to = new Date(Date.now() + 180 * 86_400_000);
    const events = parseIcs(res.text, { from, to }, sub.user.timezone);
    await prisma.$transaction([
      prisma.externalEvent.deleteMany({ where: { subscriptionId } }),
      prisma.externalEvent.createMany({
        data: events.map((e) => ({ subscriptionId, uid: e.uid, title: e.title.slice(0, 500), startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, location: e.location?.slice(0, 300) ?? null })),
        skipDuplicates: true,
      }),
      prisma.calendarSubscription.update({ where: { id: subscriptionId }, data: { lastFetchedAt: new Date(), lastError: null } }),
    ]);
    return { ok: true as const, events: events.length };
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await prisma.calendarSubscription.update({ where: { id: subscriptionId }, data: { lastError: message, lastFetchedAt: new Date() } });
    return { ok: false as const, error: message };
  }
}
