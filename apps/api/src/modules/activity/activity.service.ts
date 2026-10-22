import { Injectable } from '@nestjs/common';
import type { Prisma } from '@remindora/database';
import type { ActivityDTO } from '@remindora/types';
import { EntitlementsService } from '../../common/entitlements.service';
import { PrismaService } from '../../common/prisma.service';

export interface ActivityInput {
  workspaceId: string;
  actorId: string | null;
  verb: string;
  entityType: 'task' | 'project' | 'section' | 'comment' | 'attachment' | 'member' | 'workspace' | 'folder';
  entityId: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
}

/** Free plans see the last 7 days (max 30 events); Premium sees full history. */
const FREE_HISTORY_DAYS = 7;
const FREE_HISTORY_MAX = 30;

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async record(input: ActivityInput, tx?: Prisma.TransactionClient) {
    await (tx ?? this.prisma).activityEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        verb: input.verb,
        entityType: input.entityType,
        entityId: input.entityId,
        projectId: input.projectId ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(userId: string, where: Prisma.ActivityEventWhereInput, limit = 100): Promise<{ events: ActivityDTO[]; truncated: boolean }> {
    const full = await this.entitlements.has(userId, 'history.full');
    const filter: Prisma.ActivityEventWhereInput = full ? where : { ...where, createdAt: { gte: new Date(Date.now() - FREE_HISTORY_DAYS * 86_400_000) } };
    const take = full ? limit : Math.min(limit, FREE_HISTORY_MAX);
    const [rows, total] = await Promise.all([
      this.prisma.activityEvent.findMany({ where: filter, orderBy: { createdAt: 'desc' }, take }),
      full ? Promise.resolve(0) : this.prisma.activityEvent.count({ where }),
    ]);
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true, email: true } });
    const names = new Map(actors.map((a) => [a.id, a.name ?? a.email]));
    return {
      events: rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        verb: r.verb,
        entityType: r.entityType,
        entityId: r.entityId,
        data: r.data as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: !full && total > rows.length,
    };
  }
}
