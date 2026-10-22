import { smartListRange } from '@remindora/core';
import type { Prisma } from '@remindora/database';
import type { FilterQuery } from '@remindora/types';

/** A filter is "advanced" (Premium) when it goes beyond simple include rules. */
export function isAdvancedFilter(q: FilterQuery): boolean {
  if (q.match === 'any' || q.rules.length > 2) return true;
  return q.rules.some((r) => r.op === 'notIn' || r.field === 'assignee' || r.field === 'status' || (r.field === 'due' && (r.op === 'before' || r.op === 'after')));
}

/** Compiles a saved filter to a Prisma where clause (caller adds workspace scoping). */
export function compileFilter(q: FilterQuery, ctx: { userId: string; timezone: string; now?: Date }): Prisma.TaskWhereInput {
  const now = ctx.now ?? new Date();
  const clauses: Prisma.TaskWhereInput[] = q.rules.map((r): Prisma.TaskWhereInput => {
    switch (r.field) {
      case 'priority':
        return { priority: { [r.op]: r.value } as Prisma.EnumPriorityFilter };
      case 'tag':
        return r.op === 'in' ? { tags: { some: { tag: { name: { in: r.value.map((v) => v.toLowerCase()) } } } } } : { tags: { none: { tag: { name: { in: r.value.map((v) => v.toLowerCase()) } } } } };
      case 'project':
        return { projectId: { [r.op]: r.value } };
      case 'assignee':
        if (r.op === 'me') return { assigneeId: ctx.userId };
        if (r.op === 'none') return { assigneeId: null };
        return r.op === 'in' ? { assigneeId: { in: r.value } } : { OR: [{ assigneeId: null }, { assigneeId: { notIn: r.value } }] };
      case 'due': {
        if (r.op === 'none') return { dueAt: null };
        if (r.op === 'overdue') return { dueAt: { lt: now } };
        if (r.op === 'today') return { dueAt: { lte: smartListRange('today', now, ctx.timezone).to! } };
        if (r.op === 'next7') return { dueAt: { gte: now, lte: smartListRange('upcoming', now, ctx.timezone, 7).to! } };
        if (r.op === 'before' && r.value) return { dueAt: { lt: new Date(r.value) } };
        if (r.op === 'after' && r.value) return { dueAt: { gt: new Date(r.value) } };
        return {};
      }
      case 'status':
        return { status: { [r.op]: r.value } as Prisma.EnumTaskStatusFilter };
      case 'text':
        return { OR: [{ title: { contains: r.value, mode: 'insensitive' } }, { description: { contains: r.value, mode: 'insensitive' } }] };
    }
  });
  if (!clauses.length) return {};
  return q.match === 'any' ? { OR: clauses } : { AND: clauses };
}
