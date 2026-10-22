import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { filterQuery } from '@remindora/types';
import { z } from 'zod';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../../common/zod';
import { PlanningService } from './planning.service';

const calendarQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  view: z.enum(['month', 'week', 'agenda', 'day', '3day', 'multiweek', 'year']).optional(),
  projectId: z.uuid().optional(),
});
const filterInput = z.object({ name: z.string().trim().min(1).max(80), query: filterQuery, pinned: z.boolean().optional() });
const filterUpdate = filterInput.partial();
const templateInput = z.object({ kind: z.enum(['TASK', 'PROJECT']), name: z.string().trim().min(1).max(80), description: z.string().max(500).nullish(), payload: z.record(z.string(), z.unknown()) });
const templateFromInput = z.object({ name: z.string().trim().min(1).max(80), taskId: z.uuid().optional(), projectId: z.uuid().optional() });
const applyInput = z.object({ projectId: z.uuid().optional(), workspaceId: z.uuid().optional(), dueAt: z.iso.datetime({ offset: true }).nullish() });

@ApiTags('planning')
@ApiBearerAuth()
@Controller()
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('calendar')
  @ApiOperation({ summary: 'Tasks, recurring occurrences and subscribed events in a UTC range' })
  @ApiZodQuery(calendarQuery)
  calendar(@Auth() a: AuthContext, @Query(new ZodPipe(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    return this.planning.calendar(a.userId, { from: new Date(q.from), to: new Date(q.to), view: q.view, projectId: q.projectId });
  }

  @Get('search')
  @ApiOperation({ summary: 'Search tasks (title, description, tags), lists and tags' })
  search(@Auth() a: AuthContext, @Query('q') q = '') {
    return this.planning.search(a.userId, q.slice(0, 200));
  }

  @Get('tags')
  tags(@Auth() a: AuthContext) {
    return this.planning.tags(a.userId);
  }

  @Get('filters')
  filters(@Auth() a: AuthContext) {
    return this.planning.filters(a.userId);
  }

  @Post('filters')
  @ApiOperation({ summary: 'Save a smart filter (advanced rules require Premium)' })
  @ApiZodBody(filterInput)
  createFilter(@Auth() a: AuthContext, @Body(new ZodPipe(filterInput)) body: z.infer<typeof filterInput>) {
    return this.planning.createFilter(a.userId, body);
  }

  @Post('filters/preview')
  @HttpCode(200)
  @ApiZodBody(filterQuery)
  preview(@Auth() a: AuthContext, @Body(new ZodPipe(filterQuery)) body: z.infer<typeof filterQuery>) {
    return this.planning.runFilter(a.userId, body);
  }

  @Patch('filters/:id')
  @ApiZodBody(filterUpdate)
  updateFilter(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(filterUpdate)) body: z.infer<typeof filterUpdate>) {
    return this.planning.updateFilter(a.userId, id, body);
  }

  @Delete('filters/:id')
  deleteFilter(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.deleteFilter(a.userId, id);
  }

  @Get('filters/:id/tasks')
  runFilter(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.runFilter(a.userId, id);
  }

  @Get('templates')
  templates(@Auth() a: AuthContext) {
    return this.planning.templates(a.userId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a custom task/list template (Premium)' })
  @ApiZodBody(templateInput)
  createTemplate(@Auth() a: AuthContext, @Body(new ZodPipe(templateInput)) body: z.infer<typeof templateInput>) {
    return this.planning.createTemplate(a.userId, body);
  }

  @Post('templates/from')
  @ApiOperation({ summary: 'Save an existing task or list as a template (Premium)' })
  @ApiZodBody(templateFromInput)
  templateFrom(@Auth() a: AuthContext, @Body(new ZodPipe(templateFromInput)) body: z.infer<typeof templateFromInput>) {
    return this.planning.templateFrom(a.userId, body);
  }

  @Delete('templates/:id')
  deleteTemplate(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.deleteTemplate(a.userId, id);
  }

  @Post('templates/:id/apply')
  @ApiZodBody(applyInput)
  applyTemplate(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(applyInput)) body: z.infer<typeof applyInput>) {
    return this.planning.applyTemplate({ userId: a.userId, sessionId: a.sessionId, deviceId: a.deviceId }, id, body);
  }
}
