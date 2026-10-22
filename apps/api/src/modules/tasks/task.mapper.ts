import type { Prisma } from '@remindora/database';
import type { TaskDTO } from '@remindora/types';

export function taskInclude(userId: string) {
  return {
    tags: { include: { tag: { select: { name: true } } } },
    subtasks: { orderBy: { sortOrder: 'asc' } },
    reminders: { orderBy: { createdAt: 'asc' } },
    recurrence: true,
    dependencies: { select: { dependsOnId: true } },
    favorites: { where: { userId }, select: { userId: true } },
    _count: { select: { attachments: { where: { deletedAt: null } }, comments: { where: { deletedAt: null } } } },
  } satisfies Prisma.TaskInclude;
}

export type TaskRow = Prisma.TaskGetPayload<{ include: ReturnType<typeof taskInclude> }>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toTaskDTO(t: TaskRow): TaskDTO {
  return {
    id: t.id,
    projectId: t.projectId,
    workspaceId: t.workspaceId,
    sectionId: t.sectionId,
    parentId: t.parentId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    tags: t.tags.map((x) => x.tag.name).sort(),
    assigneeId: t.assigneeId,
    creatorId: t.creatorId,
    startAt: iso(t.startAt),
    dueAt: iso(t.dueAt),
    allDay: t.allDay,
    durationMinutes: t.durationMinutes,
    completedAt: iso(t.completedAt),
    isFavorite: t.favorites.length > 0,
    archived: t.archived,
    deletedAt: iso(t.deletedAt),
    sortOrder: t.sortOrder,
    version: t.version,
    syncSeq: t.syncSeq.toString(),
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, sortOrder: s.sortOrder, remindAt: iso(s.remindAt) })),
    reminders: t.reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      at: iso(r.at),
      constant: r.constant,
      subtaskId: r.subtaskId,
      nextFireAt: iso(r.nextFireAt),
      attempt: r.attempt,
      state: r.state,
    })),
    recurrence: t.recurrence ? { rrule: t.recurrence.rrule, mode: t.recurrence.mode, until: iso(t.recurrence.until), timezone: t.recurrence.timezone } : null,
    dependsOn: t.dependencies.map((d) => d.dependsOnId),
    attachmentCount: t._count.attachments,
    commentCount: t._count.comments,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
