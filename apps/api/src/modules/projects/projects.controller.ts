import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { ProjectsService } from './projects.service';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const view = z.enum(['LIST', 'KANBAN', 'CALENDAR', 'TIMELINE', 'AGENDA', 'MATRIX']);
const createInput = z.object({
  workspaceId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  color: color.optional(),
  icon: z.string().max(40).nullish(),
  folderId: z.uuid().nullish(),
  defaultView: view.optional(),
  sections: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});
const updateInput = z
  .object({ name: z.string().trim().min(1).max(120), color, icon: z.string().max(40).nullable(), folderId: z.uuid().nullable(), defaultView: view, archived: z.boolean(), sortOrder: z.number() })
  .partial();
const sectionInput = z.object({ name: z.string().trim().min(1).max(80) });
const sectionUpdate = z.object({ name: z.string().trim().min(1).max(80), sortOrder: z.number() }).partial();

@ApiTags('projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  list(@Auth() a: AuthContext, @Query('workspaceId') workspaceId?: string, @Query('archived') archived?: string) {
    return this.projects.list(a.userId, workspaceId, archived === 'true');
  }

  @Get('projects/:id')
  get(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(a.userId, id);
  }

  @Post('projects')
  @ApiZodBody(createInput)
  create(@Auth() a: AuthContext, @Body(new ZodPipe(createInput)) body: z.infer<typeof createInput>) {
    return this.projects.create(a.userId, body, a.sessionId);
  }

  @Patch('projects/:id')
  @ApiZodBody(updateInput)
  update(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateInput)) body: z.infer<typeof updateInput>) {
    return this.projects.update(a.userId, id, body, a.sessionId);
  }

  @Delete('projects/:id')
  remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(a.userId, id, a.sessionId);
  }

  @Post('projects/:id/restore')
  @HttpCode(200)
  restore(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.restore(a.userId, id);
  }

  @Get('projects/:id/activity')
  activity(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.activityFor(a.userId, id);
  }

  @Post('projects/:id/sections')
  @ApiZodBody(sectionInput)
  createSection(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sectionInput)) body: z.infer<typeof sectionInput>) {
    return this.projects.createSection(a.userId, id, body.name);
  }

  @Patch('sections/:id')
  @ApiZodBody(sectionUpdate)
  updateSection(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sectionUpdate)) body: z.infer<typeof sectionUpdate>) {
    return this.projects.updateSection(a.userId, id, body);
  }

  @Delete('sections/:id')
  deleteSection(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.deleteSection(a.userId, id);
  }
}
