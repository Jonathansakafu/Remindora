import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SyncChangesDTO } from '@remindora/types';
import { AccessService } from '../../common/access.service';
import { Auth } from '../../common/auth';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AuthContext } from '../../common/request';
import { toProjectDTO } from '../projects/projects.service';
import { taskInclude, toTaskDTO } from '../tasks/task.mapper';

/**
 * Offline sync feed. Every task/project write bumps a global `syncSeq` (DB trigger).
 * Clients persist the returned cursor and pull `syncSeq > cursor`, including
 * soft-deleted tombstones, to reconcile their local cache after being offline.
 */
@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get('changes')
  @ApiOperation({ summary: 'Changes since cursor (tasks + projects, with tombstones)' })
  async changes(@Auth() a: AuthContext, @Query('cursor') cursorRaw = '0', @Query('limit') limitRaw = '500'): Promise<SyncChangesDTO> {
    if (!/^\d{1,19}$/.test(cursorRaw)) throw Errors.badRequest('Invalid cursor');
    const cursor = BigInt(cursorRaw);
    const limit = Math.min(Math.max(Number(limitRaw) || 500, 1), 1000);
    const ids = await this.access.workspaceIds(a.userId);
    const [tasks, projects] = await Promise.all([
      this.prisma.task.findMany({ where: { workspaceId: { in: ids }, syncSeq: { gt: cursor } }, include: taskInclude(a.userId), orderBy: { syncSeq: 'asc' }, take: limit }),
      this.prisma.project.findMany({ where: { workspaceId: { in: ids }, syncSeq: { gt: cursor } }, include: { sections: true }, orderBy: { syncSeq: 'asc' }, take: limit }),
    ]);
    // Only advance the cursor to the point both lists are complete up to.
    const lastTask = tasks.length === limit ? tasks[tasks.length - 1]!.syncSeq : null;
    const lastProject = projects.length === limit ? projects[projects.length - 1]!.syncSeq : null;
    const bound = [lastTask, lastProject].filter((v): v is bigint => v !== null).reduce<bigint | null>((m, v) => (m === null || v < m ? v : m), null);
    const keptTasks = bound === null ? tasks : tasks.filter((t) => t.syncSeq <= bound);
    const keptProjects = bound === null ? projects : projects.filter((p) => p.syncSeq <= bound);
    const max = [...keptTasks.map((t) => t.syncSeq), ...keptProjects.map((p) => p.syncSeq)].reduce((m, v) => (v > m ? v : m), cursor);
    return {
      cursor: max.toString(),
      hasMore: bound !== null,
      tasks: keptTasks.map(toTaskDTO),
      projects: keptProjects.map((p) => toProjectDTO(p)),
    };
  }
}
