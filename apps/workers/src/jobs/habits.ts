import { decideChannels } from '@remindora/notifications';
import { DateTime } from 'luxon';
import type { Deps } from '../deps';
import { deliver } from '../delivery/deliver';
import { effectivePrefs } from '../prefs';

/** Habit reminders at each habit's local reminder time, if not yet checked in today. */
export async function runHabitReminders(d: Deps, now = new Date()) {
  const habits = await d.prisma.habit.findMany({
    where: { reminderTime: { not: null }, archived: false, deletedAt: null },
    include: { user: { include: { notificationPref: true } } },
    take: 5000,
  });
  let sent = 0;
  for (const h of habits) {
    const local = DateTime.fromJSDate(now).setZone(h.user.timezone);
    const today = local.toISODate()!;
    if (h.lastRemindedOn === today) continue;
    if (h.frequency === 'DAILY' && h.weekdays.length && !h.weekdays.includes(local.weekday)) continue;
    const [hh, mm] = h.reminderTime!.split(':').map(Number);
    const mins = local.hour * 60 + local.minute;
    const target = hh! * 60 + mm!;
    if (mins < target || mins > target + 120) continue;
    const done = await d.prisma.habitCheckIn.findUnique({ where: { habitId_date: { habitId: h.id, date: today } } });
    const claimed = await d.prisma.habit.updateMany({ where: { id: h.id, OR: [{ lastRemindedOn: null }, { lastRemindedOn: { not: today } }] }, data: { lastRemindedOn: today } });
    if (!claimed.count || done) continue;
    const prefs = effectivePrefs(h.user.notificationPref, null, h.user.timezone);
    const n = await d.prisma.notification.create({
      data: { userId: h.userId, kind: 'HABIT', priority: 'MEDIUM', title: h.name, body: 'Time for your habit — keep the streak going.', dedupeKey: `habit:${h.id}:${today}`, data: { habitId: h.id } },
    });
    await deliver(d, n, decideChannels('MEDIUM', prefs).channels.filter((c) => c !== 'EMAIL'), { silent: false, link: `${d.env.WEB_URL}/app/habits` });
    sent++;
  }
  return sent;
}
