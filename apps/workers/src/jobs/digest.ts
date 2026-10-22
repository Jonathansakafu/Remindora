import { decideChannels, digestDue, templates } from '@remindora/notifications';
import { DateTime } from 'luxon';
import type { Deps } from '../deps';
import { deliver } from '../delivery/deliver';
import { effectivePrefs } from '../prefs';

const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 } as const;

/**
 * Morning priority digest and evening planning reminder, once per local day per user.
 * The per-day claim is an atomic conditional update, so multiple worker replicas
 * never double-send.
 */
export async function runDigests(d: Deps, now = new Date(), onSlack?: (userId: string, heading: string, lines: string[]) => Promise<void>) {
  let sent = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await d.prisma.notificationPreference.findMany({
      where: { OR: [{ morningDigestEnabled: true }, { eveningPlanningEnabled: true }], user: { deletedAt: null } },
      include: { user: true },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {}),
      orderBy: { userId: 'asc' },
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1]!.userId;

    for (const pref of batch) {
      const prefs = effectivePrefs(pref, null, pref.user.timezone);
      const today = DateTime.fromJSDate(now).setZone(pref.user.timezone).toISODate()!;
      for (const kind of ['morning', 'evening'] as const) {
        const last = kind === 'morning' ? pref.lastMorningDigestOn : pref.lastEveningDigestOn;
        if (!digestDue(kind, prefs, last, now)) continue;
        const field = kind === 'morning' ? 'lastMorningDigestOn' : 'lastEveningDigestOn';
        const claimed = await d.prisma.notificationPreference.updateMany({
          where: { userId: pref.userId, OR: [{ [field]: null }, { [field]: { not: today } }] },
          data: { [field]: today },
        });
        if (!claimed.count) continue;
        const content = await compose(d, pref.userId, pref.user.timezone, kind, now);
        if (!content) continue;
        const n = await d.prisma.notification.create({
          data: { userId: pref.userId, kind: 'DIGEST', priority: 'MEDIUM', title: content.heading, body: content.lines.slice(0, 4).join(' · '), silent: false, dedupeKey: `digest:${kind}:${pref.userId}:${today}`, data: { kind, lines: content.lines } },
        });
        const channels = decideChannels('MEDIUM', prefs).channels.filter((c) => c !== 'EMAIL');
        await deliver(d, n, channels, { silent: false, link: `${d.env.WEB_URL}/app/today` });
        if (prefs.channels.email) {
          await d.email.send({ ...templates.digest(content.heading, content.lines, `${d.env.WEB_URL}/app/today`), to: pref.user.email }).catch((e) => d.log.warn({ err: (e as Error).message }, 'digest email failed'));
        }
        await onSlack?.(pref.userId, content.heading, content.lines);
        sent++;
      }
    }
  }
  return sent;
}

async function compose(d: Deps, userId: string, tz: string, kind: 'morning' | 'evening', now: Date) {
  const local = DateTime.fromJSDate(now).setZone(tz);
  const personal = await d.prisma.workspace.findFirst({ where: { ownerId: userId, isPersonal: true } });
  const ids = (await d.prisma.membership.findMany({ where: { userId }, select: { workspaceId: true } })).map((m) => m.workspaceId);
  const mine = { workspaceId: { in: ids }, deletedAt: null, archived: false, completedAt: null, OR: [{ workspaceId: personal?.id }, { assigneeId: userId }] };

  if (kind === 'morning') {
    const tasks = await d.prisma.task.findMany({ where: { ...mine, dueAt: { lte: local.endOf('day').toJSDate() } }, take: 50 });
    if (!tasks.length) return null;
    tasks.sort((a, b) => RANK[b.priority] - RANK[a.priority] || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
    const overdue = tasks.filter((t) => t.dueAt && t.dueAt < local.startOf('day').toJSDate()).length;
    const lines = tasks.slice(0, 8).map((t) => `${t.priority !== 'NONE' ? `[${t.priority}] ` : ''}${t.title}${t.dueAt && !t.allDay ? ` — ${DateTime.fromJSDate(t.dueAt).setZone(tz).toFormat('HH:mm')}` : ''}`);
    return { heading: `Good morning — ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} today${overdue ? `, ${overdue} overdue` : ''}`, lines };
  }

  const tomorrow = local.plus({ days: 1 });
  const [dueTomorrow, leftToday] = await Promise.all([
    d.prisma.task.count({ where: { ...mine, dueAt: { gte: tomorrow.startOf('day').toJSDate(), lte: tomorrow.endOf('day').toJSDate() } } }),
    d.prisma.task.count({ where: { ...mine, dueAt: { lte: local.endOf('day').toJSDate() } } }),
  ]);
  return {
    heading: 'Plan tomorrow',
    lines: [`${dueTomorrow} ${dueTomorrow === 1 ? 'task is' : 'tasks are'} due tomorrow`, leftToday ? `${leftToday} unfinished today — reschedule or let go` : 'Everything due today is done ✓'],
  };
}
