import { Injectable } from '@nestjs/common';
import { computeStreaks, localDateKey } from '@remindora/core';
import type { AnalyticsSummaryDTO, Priority } from '@remindora/types';
import { DateTime } from 'luxon';
import { AccessService } from '../../common/access.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async summary(userId: string, fromIso?: string, toIso?: string): Promise<AnalyticsSummaryDTO> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const tz = user.timezone;
    const to = toIso ? DateTime.fromISO(toIso).setZone(tz) : DateTime.now().setZone(tz).endOf('day');
    const from = fromIso ? DateTime.fromISO(fromIso).setZone(tz) : to.minus({ days: 29 }).startOf('day');
    if (to.diff(from, 'days').days > 366) throw Errors.badRequest('Range too large');
    const ent = await this.entitlements.forUser(userId);
    if (!ent.features['stats.basic']) throw Errors.planFeature('stats.basic');

    const ids = await this.access.workspaceIds(userId);
    const personal = await this.access.personalWorkspace(userId);
    const mine = { workspaceId: { in: ids }, deletedAt: null, OR: [{ workspaceId: personal.id }, { assigneeId: userId }] };
    const range = { gte: from.toJSDate(), lte: to.toJSDate() };

    const [completed, created, openDue, overdue, focus, habits, projects] = await Promise.all([
      this.prisma.task.findMany({ where: { ...mine, completedAt: range }, select: { completedAt: true, createdAt: true, priority: true, projectId: true } }),
      this.prisma.task.findMany({ where: { ...mine, createdAt: range }, select: { createdAt: true } }),
      this.prisma.task.count({ where: { ...mine, completedAt: null, dueAt: range } }),
      this.prisma.task.count({ where: { ...mine, completedAt: null, dueAt: { lt: new Date() } } }),
      this.prisma.focusSession.findMany({ where: { userId, kind: 'FOCUS', startedAt: range }, select: { startedAt: true, actualSeconds: true } }),
      this.prisma.habit.findMany({ where: { userId, deletedAt: null, archived: false }, include: { checkIns: true } }),
      this.prisma.project.findMany({ where: { workspaceId: { in: ids }, deletedAt: null, archived: false }, select: { id: true, name: true, color: true } }),
    ]);

    const byPriority: Record<Priority, number> = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const t of completed) byPriority[t.priority]++;

    const openByProject = await this.prisma.task.groupBy({ by: ['projectId'], where: { ...mine, completedAt: null }, _count: { _all: true } });
    const doneByProject = new Map<string, number>();
    for (const t of completed) doneByProject.set(t.projectId, (doneByProject.get(t.projectId) ?? 0) + 1);
    const openMap = new Map(openByProject.map((g) => [g.projectId, g._count._all]));
    const byProject = projects
      .map((p) => ({ projectId: p.id, name: p.name, color: p.color, completed: doneByProject.get(p.id) ?? 0, open: openMap.get(p.id) ?? 0 }))
      .filter((p) => p.completed || p.open)
      .sort((a, b) => b.completed + b.open - (a.completed + a.open));

    const days = Math.max(1, Math.round(to.diff(from, 'days').days));
    const daily = Array.from({ length: days }, (_, i) => ({ date: from.plus({ days: i }).toISODate()!, completed: 0, created: 0, focusMinutes: 0 }));
    const index = new Map(daily.map((d, i) => [d.date, i]));
    for (const t of completed) {
      const i = index.get(localDateKey(t.completedAt!, tz));
      if (i !== undefined) daily[i]!.completed++;
    }
    for (const t of created) {
      const i = index.get(localDateKey(t.createdAt, tz));
      if (i !== undefined) daily[i]!.created++;
    }
    for (const f of focus) {
      const i = index.get(localDateKey(f.startedAt, tz));
      if (i !== undefined) daily[i]!.focusMinutes += Math.round(f.actualSeconds / 60);
    }

    const today = localDateKey(new Date(), tz);
    const consistency = habits.length
      ? habits.reduce((acc, h) => acc + computeStreaks({ frequency: h.frequency, weekdays: h.weekdays, targetPerPeriod: h.targetPerPeriod }, h.checkIns.map((c) => c.date), today, Math.min(days, 90)).consistency, 0) / habits.length
      : 0;

    const summary: AnalyticsSummaryDTO = {
      range: { from: from.toUTC().toISO()!, to: to.toUTC().toISO()! },
      completed: completed.length,
      created: created.length,
      completionRate: completed.length + openDue ? completed.length / (completed.length + openDue) : 0,
      overdue,
      focusMinutes: Math.round(focus.reduce((a, f) => a + f.actualSeconds, 0) / 60),
      habitConsistency: consistency,
      byPriority,
      byProject,
      daily,
    };

    if (ent.features['stats.premium']) {
      const hours = new Array(24).fill(0) as number[];
      for (const t of completed) hours[DateTime.fromJSDate(t.completedAt!).setZone(tz).hour]!++;
      const best = completed.length ? hours.indexOf(Math.max(...hours)) : null;
      const avg = completed.length ? completed.reduce((a, t) => a + (t.completedAt!.getTime() - t.createdAt.getTime()), 0) / completed.length / 3_600_000 : null;
      let streak = 0;
      for (let i = daily.length - 1; i >= 0; i--) {
        if (daily[i]!.completed > 0) streak++;
        else if (daily[i]!.date !== today) break;
      }
      const last7 = daily.slice(-7).reduce((a, d) => a + d.completed, 0);
      const prev7 = daily.slice(-14, -7).reduce((a, d) => a + d.completed, 0);
      summary.premium = { bestHour: best, averageCompletionHours: avg ? Math.round(avg * 10) / 10 : null, streakDays: streak, weekOverWeek: prev7 ? (last7 - prev7) / prev7 : null };
    }
    return summary;
  }

  /** Premium productivity report: summary + completed task list, as JSON or CSV. */
  async report(userId: string, format: 'json' | 'csv', fromIso?: string, toIso?: string) {
    await this.entitlements.assertFeature(userId, 'reports');
    const summary = await this.summary(userId, fromIso, toIso);
    const ids = await this.access.workspaceIds(userId);
    const tasks = await this.prisma.task.findMany({
      where: { workspaceId: { in: ids }, completedById: userId, completedAt: { gte: new Date(summary.range.from), lte: new Date(summary.range.to) } },
      include: { project: { select: { name: true } }, tags: { include: { tag: true } } },
      orderBy: { completedAt: 'asc' },
    });
    if (format === 'json') return { summary, tasks: tasks.map((t) => ({ title: t.title, project: t.project.name, priority: t.priority, completedAt: t.completedAt, tags: t.tags.map((x) => x.tag.name) })) };
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Completed at', 'Title', 'List', 'Priority', 'Tags'].map(esc).join(','),
      ...tasks.map((t) => [t.completedAt?.toISOString(), t.title, t.project.name, t.priority, t.tags.map((x) => x.tag.name).join(' ')].map(esc).join(',')),
      '',
      ['Summary', `Completed ${summary.completed}`, `Created ${summary.created}`, `Completion rate ${(summary.completionRate * 100).toFixed(0)}%`, `Focus ${summary.focusMinutes} min`].map(esc).join(','),
    ];
    return lines.join('\n');
  }
}
