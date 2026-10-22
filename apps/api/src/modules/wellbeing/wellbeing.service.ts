import { Injectable } from '@nestjs/common';
import { computeStreaks, localDateKey } from '@remindora/core';
import type { Habit, HabitCheckIn } from '@remindora/database';
import type { CountdownDTO, FocusSessionDTO, HabitDTO } from '@remindora/types';
import { DateTime } from 'luxon';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class WellbeingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async tz(userId: string) {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } })).timezone;
  }

  // ───────────── Habits ─────────────

  private toHabitDTO(h: Habit & { checkIns: HabitCheckIn[] }, today: string): HabitDTO {
    const dates = h.checkIns.map((c) => c.date);
    const s = computeStreaks({ frequency: h.frequency, weekdays: h.weekdays, targetPerPeriod: h.targetPerPeriod }, dates, today);
    return {
      id: h.id,
      name: h.name,
      icon: h.icon,
      color: h.color,
      frequency: h.frequency,
      weekdays: h.weekdays,
      targetPerPeriod: h.targetPerPeriod,
      reminderTime: h.reminderTime,
      archived: h.archived,
      currentStreak: s.current,
      bestStreak: s.best,
      checkIns: dates.sort(),
    };
  }

  async habits(userId: string, includeArchived = false) {
    const tz = await this.tz(userId);
    const today = localDateKey(new Date(), tz);
    const since = DateTime.fromISO(today).minus({ days: 400 }).toISODate()!;
    const rows = await this.prisma.habit.findMany({
      where: { userId, deletedAt: null, ...(includeArchived ? {} : { archived: false }) },
      include: { checkIns: { where: { date: { gte: since } } } },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((h) => this.toHabitDTO(h, today));
  }

  async createHabit(userId: string, input: { name: string; icon?: string | null; color?: string; frequency: 'DAILY' | 'WEEKLY'; weekdays: number[]; targetPerPeriod: number; reminderTime?: string | null }) {
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'habits.max', await this.prisma.habit.count({ where: { userId, deletedAt: null } }));
    const max = await this.prisma.habit.aggregate({ where: { userId }, _max: { sortOrder: true } });
    const h = await this.prisma.habit.create({ data: { userId, ...input, icon: input.icon ?? null, reminderTime: input.reminderTime ?? null, sortOrder: (max._max.sortOrder ?? 0) + 1 }, include: { checkIns: true } });
    return this.toHabitDTO(h, localDateKey(new Date(), await this.tz(userId)));
  }

  async updateHabit(userId: string, id: string, data: Partial<{ name: string; icon: string | null; color: string; frequency: 'DAILY' | 'WEEKLY'; weekdays: number[]; targetPerPeriod: number; reminderTime: string | null; archived: boolean; sortOrder: number }>) {
    const res = await this.prisma.habit.updateMany({ where: { id, userId, deletedAt: null }, data });
    if (!res.count) throw Errors.notFound('Habit');
    return (await this.habits(userId, true)).find((h) => h.id === id)!;
  }

  async deleteHabit(userId: string, id: string) {
    const res = await this.prisma.habit.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw Errors.notFound('Habit');
    return { ok: true };
  }

  /** Toggles a check-in for a local date (today or up to 7 days back — never the future). */
  async checkIn(userId: string, id: string, date: string | undefined, done: boolean) {
    const habit = await this.prisma.habit.findFirst({ where: { id, userId, deletedAt: null } });
    if (!habit) throw Errors.notFound('Habit');
    const tz = await this.tz(userId);
    const today = localDateKey(new Date(), tz);
    const day = date ?? today;
    if (day > today) throw Errors.badRequest('You can’t check in for a future day');
    if (DateTime.fromISO(today).diff(DateTime.fromISO(day), 'days').days > 7) throw Errors.badRequest('Check-ins can be backfilled up to 7 days');
    if (done) await this.prisma.habitCheckIn.upsert({ where: { habitId_date: { habitId: id, date: day } }, create: { habitId: id, date: day }, update: {} });
    else await this.prisma.habitCheckIn.deleteMany({ where: { habitId: id, date: day } });
    return (await this.habits(userId, true)).find((h) => h.id === id)!;
  }

  async habitStats(userId: string, id: string) {
    const habit = await this.prisma.habit.findFirst({ where: { id, userId, deletedAt: null }, include: { checkIns: true } });
    if (!habit) throw Errors.notFound('Habit');
    const tz = await this.tz(userId);
    const today = DateTime.fromISO(localDateKey(new Date(), tz));
    const set = new Set(habit.checkIns.map((c) => c.date));
    const heatmap = Array.from({ length: 365 }, (_, i) => {
      const d = today.minus({ days: 364 - i }).toISODate()!;
      return { date: d, count: set.has(d) ? 1 : 0 };
    });
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const start = today.startOf('week').minus({ weeks: 11 - i });
      let count = 0;
      for (let d = 0; d < 7; d++) if (set.has(start.plus({ days: d }).toISODate()!)) count++;
      return { weekStart: start.toISODate()!, count };
    });
    const streaks = computeStreaks({ frequency: habit.frequency, weekdays: habit.weekdays, targetPerPeriod: habit.targetPerPeriod }, [...set], today.toISODate()!, 90);
    return { heatmap, weekly, ...streaks, total: set.size };
  }

  // ───────────── Focus ─────────────

  private toFocusDTO(s: { id: string; taskId: string | null; kind: 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK'; startedAt: Date; endedAt: Date | null; plannedMinutes: number; actualSeconds: number; completed: boolean }): FocusSessionDTO {
    return { ...s, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null };
  }

  async startFocus(userId: string, input: { taskId?: string | null; kind: 'FOCUS' | 'SHORT_BREAK' | 'LONG_BREAK'; plannedMinutes: number }) {
    if (input.taskId) {
      const task = await this.prisma.task.findFirst({ where: { id: input.taskId, deletedAt: null, workspace: { memberships: { some: { userId } } } } });
      if (!task) throw Errors.notFound('Task');
    }
    // Close any session left open (e.g. app killed mid-session).
    const open = await this.prisma.focusSession.findMany({ where: { userId, endedAt: null } });
    for (const o of open) {
      const elapsed = Math.min(Math.round((Date.now() - o.startedAt.getTime()) / 1000), o.plannedMinutes * 60);
      await this.prisma.focusSession.update({ where: { id: o.id }, data: { endedAt: new Date(), actualSeconds: elapsed, completed: false } });
    }
    const s = await this.prisma.focusSession.create({ data: { userId, taskId: input.taskId ?? null, kind: input.kind, plannedMinutes: input.plannedMinutes, startedAt: new Date() } });
    return this.toFocusDTO(s);
  }

  async finishFocus(userId: string, id: string, input: { completed: boolean; actualSeconds?: number }) {
    const s = await this.prisma.focusSession.findFirst({ where: { id, userId } });
    if (!s) throw Errors.notFound('Focus session');
    if (s.endedAt) return this.toFocusDTO(s);
    const elapsed = Math.round((Date.now() - s.startedAt.getTime()) / 1000);
    // Never trust a client-reported duration longer than wall-clock elapsed.
    const actual = Math.max(0, Math.min(input.actualSeconds ?? elapsed, elapsed));
    const done = await this.prisma.focusSession.update({ where: { id }, data: { endedAt: new Date(), actualSeconds: actual, completed: input.completed } });
    return this.toFocusDTO(done);
  }

  async focusSessions(userId: string, from: Date, to: Date) {
    const rows = await this.prisma.focusSession.findMany({ where: { userId, startedAt: { gte: from, lte: to } }, orderBy: { startedAt: 'desc' }, take: 1000 });
    return rows.map((s) => this.toFocusDTO(s));
  }

  async focusStats(userId: string) {
    const tz = await this.tz(userId);
    const now = DateTime.now().setZone(tz);
    const since = now.minus({ days: 29 }).startOf('day');
    const rows = await this.prisma.focusSession.findMany({ where: { userId, kind: 'FOCUS', startedAt: { gte: since.toJSDate() } }, include: { task: { select: { title: true } } } });
    const byDay = new Map<string, number>();
    const byTask = new Map<string, { title: string; minutes: number }>();
    for (const r of rows) {
      const key = DateTime.fromJSDate(r.startedAt).setZone(tz).toISODate()!;
      byDay.set(key, (byDay.get(key) ?? 0) + r.actualSeconds / 60);
      if (r.taskId) {
        const prev = byTask.get(r.taskId) ?? { title: r.task?.title ?? 'Task', minutes: 0 };
        prev.minutes += r.actualSeconds / 60;
        byTask.set(r.taskId, prev);
      }
    }
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = since.plus({ days: i }).toISODate()!;
      return { date: d, minutes: Math.round(byDay.get(d) ?? 0) };
    });
    const todayKey = now.toISODate()!;
    const weekStart = now.startOf('week');
    return {
      todayMinutes: Math.round(byDay.get(todayKey) ?? 0),
      weekMinutes: Math.round(days.filter((d) => d.date >= weekStart.toISODate()!).reduce((a, d) => a + d.minutes, 0)),
      sessionsToday: rows.filter((r) => r.completed && DateTime.fromJSDate(r.startedAt).setZone(tz).toISODate() === todayKey).length,
      days,
      topTasks: [...byTask.entries()].map(([taskId, v]) => ({ taskId, title: v.title, minutes: Math.round(v.minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 5),
    };
  }

  // ───────────── Countdowns ─────────────

  private toCountdownDTO(c: { id: string; title: string; targetAt: Date; color: string; icon: string | null }): CountdownDTO {
    return { id: c.id, title: c.title, targetAt: c.targetAt.toISOString(), color: c.color, icon: c.icon };
  }

  async countdowns(userId: string) {
    const rows = await this.prisma.countdown.findMany({ where: { userId, deletedAt: null }, orderBy: { targetAt: 'asc' } });
    return rows.map((c) => this.toCountdownDTO(c));
  }

  async createCountdown(userId: string, input: { title: string; targetAt: string; color?: string; icon?: string | null }) {
    const ent = await this.entitlements.forUser(userId);
    await this.entitlements.assertLimit(ent, 'countdowns.max', await this.prisma.countdown.count({ where: { userId, deletedAt: null } }));
    const c = await this.prisma.countdown.create({ data: { userId, title: input.title, targetAt: new Date(input.targetAt), color: input.color ?? '#A58CFF', icon: input.icon ?? null } });
    return this.toCountdownDTO(c);
  }

  async updateCountdown(userId: string, id: string, input: Partial<{ title: string; targetAt: string; color: string; icon: string | null }>) {
    const res = await this.prisma.countdown.updateMany({ where: { id, userId, deletedAt: null }, data: { ...input, ...(input.targetAt ? { targetAt: new Date(input.targetAt) } : {}) } });
    if (!res.count) throw Errors.notFound('Countdown');
    return this.toCountdownDTO(await this.prisma.countdown.findUniqueOrThrow({ where: { id } }));
  }

  async deleteCountdown(userId: string, id: string) {
    const res = await this.prisma.countdown.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw Errors.notFound('Countdown');
    return { ok: true };
  }
}
