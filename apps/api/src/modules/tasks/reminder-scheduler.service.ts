import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@remindora/database';
import { initialFireAt } from '@remindora/notifications';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../../queues/queue.service';
import { effectivePrefs } from '../notifications/preferences';

/**
 * Computes each reminder's next fire time from the task + recipient preferences
 * and queues a delayed job. The DB (`Reminder.nextFireAt`) is the source of truth;
 * the worker's minute sweeper re-queues anything Redis lost.
 */
@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger('ReminderScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async rescheduleTask(taskId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: { reminders: { include: { user: { include: { notificationPref: true } }, subtask: true } } },
    });
    if (!task) return;
    const closed = task.completedAt || task.deletedAt || task.archived;
    const toQueue: Array<{ id: string; at: Date }> = [];

    for (const r of task.reminders) {
      if (closed) {
        if (r.state === 'ACTIVE' || r.state === 'SNOOZED') {
          await db.reminder.update({ where: { id: r.id }, data: { state: task.completedAt ? 'DONE' : 'STOPPED', nextFireAt: null } });
        }
        continue;
      }
      if (r.state === 'STOPPED' || r.state === 'ACKNOWLEDGED') continue;
      const override = await db.projectNotificationOverride.findUnique({ where: { userId_projectId: { userId: r.userId, projectId: task.projectId } } });
      const prefs = effectivePrefs(r.user.notificationPref, override, r.user.timezone);
      const absolute = r.subtask?.remindAt ?? r.at;
      const fireAt = initialFireAt({ at: absolute, offsetMinutes: r.offsetMinutes }, { dueAt: task.dueAt, allDay: task.allDay }, prefs, task.priority);
      const future = fireAt && fireAt.getTime() > Date.now() - 60_000 ? fireAt : null;
      await db.reminder.update({
        where: { id: r.id },
        data: { state: 'ACTIVE', nextFireAt: future, occurrenceAt: future, attempt: 0, lockedUntil: null },
      });
      if (future) {
        toQueue.push({ id: r.id, at: future });
        await db.notificationEvent.create({ data: { userId: r.userId, reminderId: r.id, type: 'SCHEDULED', metadata: { at: future.toISOString(), attempt: 0 } } });
      }
    }

    // Queue after the transaction has written nextFireAt; the worker re-validates against the DB anyway.
    const enqueue = async () => {
      for (const q of toQueue) {
        await this.queues.scheduleReminder(q.id, q.at, 0).catch((e) => this.logger.warn(`enqueue failed (sweeper will retry): ${(e as Error).message}`));
      }
    };
    if (tx) setImmediate(() => void enqueue());
    else await enqueue();
  }
}
