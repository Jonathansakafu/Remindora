import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { bulkTaskInput, createTaskInput, PRIORITIES, reminderInput, updateTaskInput } from '@remindora/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth, Public } from '../../common/auth';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AuthContext } from '../../common/request';
import { StorageService } from '../../common/storage/storage.service';
import { ApiZodBody, ApiZodQuery, q, ZodPipe } from '../../common/zod';
import { ENV, type ServerEnv } from '../../config';
import { Inject } from '@nestjs/common';
import { TaskExtrasService } from './task-extras.service';
import { TasksService } from './tasks.service';

const queryInput = z.object({
  view: z.enum(['inbox', 'today', 'upcoming', 'overdue', 'reminders', 'assigned', 'completed', 'favorites', 'archive', 'trash', 'all']).optional(),
  projectId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  q: z.string().max(200).optional(),
  tags: q.list(z.string()).optional(),
  priorities: q.list(z.enum(PRIORITIES as [string, ...string[]])).optional(),
  assigneeId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  includeCompleted: q.bool().optional(),
  limit: q.int().pipe(z.number().min(1).max(1000)).default(500),
});
const textInput = z.object({ text: z.string().trim().min(1).max(1000), projectId: z.uuid().optional() });
const favoriteInput = z.object({ favorite: z.boolean() });
const subtaskInput = z.object({ title: z.string().trim().min(1).max(500) });
const subtaskUpdate = z.object({ title: z.string().trim().min(1).max(500), done: z.boolean(), sortOrder: z.number(), remindAt: z.iso.datetime({ offset: true }).nullable() }).partial();
const commentInput = z.object({ body: z.string().trim().min(1).max(10_000), mentions: z.array(z.uuid()).max(50).default([]) });
const commentEdit = z.object({ body: z.string().trim().min(1).max(10_000) });
const attachmentInput = z.object({ fileName: z.string().trim().min(1).max(200), contentType: z.string().min(3).max(120), sizeBytes: z.number().int().min(1) });

@ApiTags('tasks')
@ApiBearerAuth()
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly extras: TaskExtrasService,
  ) {}

  private ctx(a: AuthContext) {
    return { userId: a.userId, sessionId: a.sessionId, deviceId: a.deviceId };
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Query tasks: smart lists (inbox/today/upcoming/overdue/…), project, search, filters' })
  @ApiZodQuery(queryInput)
  list(@Auth() a: AuthContext, @Query(new ZodPipe(queryInput)) query: z.infer<typeof queryInput>) {
    return this.tasks.query(a.userId, query);
  }

  @Get('tasks/:id')
  get(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(a.userId, id);
  }

  @Get('tasks/:id/children')
  children(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.children(a.userId, id);
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Create a task (plan limits enforced; clientId makes offline replays idempotent)' })
  @ApiZodBody(createTaskInput)
  create(@Auth() a: AuthContext, @Body(new ZodPipe(createTaskInput)) body: z.infer<typeof createTaskInput>) {
    return this.tasks.create(this.ctx(a), body);
  }

  @Post('tasks/parse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview natural-language Quick Add parsing' })
  @ApiZodBody(textInput)
  parse(@Auth() a: AuthContext, @Body(new ZodPipe(textInput)) body: z.infer<typeof textInput>) {
    return this.tasks.parse(a.userId, body.text);
  }

  @Post('tasks/quick-add')
  @ApiOperation({ summary: 'Parse natural language and create the task, e.g. “Submit report every Friday at 4pm #work !high”' })
  @ApiZodBody(textInput)
  quickAdd(@Auth() a: AuthContext, @Body(new ZodPipe(textInput)) body: z.infer<typeof textInput>) {
    return this.tasks.quickAdd(this.ctx(a), body.text, body.projectId);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Update a task. Send baseVersion for field-level conflict detection (409 edit_conflict).' })
  @ApiZodBody(updateTaskInput)
  update(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateTaskInput)) body: z.infer<typeof updateTaskInput>) {
    return this.tasks.update(this.ctx(a), id, body);
  }

  @Put('tasks/:id/favorite')
  @ApiZodBody(favoriteInput)
  favorite(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(favoriteInput)) body: z.infer<typeof favoriteInput>) {
    return this.tasks.setFavorite(a.userId, id, body.favorite);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete (spawns the next occurrence for repeating tasks; resolves reminders everywhere)' })
  complete(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.complete(this.ctx(a), id);
  }

  @Post('tasks/:id/reopen')
  @HttpCode(200)
  reopen(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.reopen(this.ctx(a), id);
  }

  @Post('tasks/:id/duplicate')
  duplicate(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.duplicate(this.ctx(a), id);
  }

  @Delete('tasks/:id')
  @ApiOperation({ summary: 'Move to Trash (soft delete)' })
  remove(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(this.ctx(a), id);
  }

  @Post('tasks/:id/restore')
  @HttpCode(200)
  restore(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.restore(this.ctx(a), id);
  }

  @Delete('tasks/:id/permanent')
  @ApiOperation({ summary: 'Delete forever (only from Trash)' })
  purge(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.purge(this.ctx(a), id);
  }

  @Post('trash/empty')
  @HttpCode(200)
  emptyTrash(@Auth() a: AuthContext) {
    return this.tasks.emptyTrash(this.ctx(a));
  }

  @Post('tasks/bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk actions; each task is authorized individually' })
  @ApiZodBody(bulkTaskInput)
  bulk(@Auth() a: AuthContext, @Body(new ZodPipe(bulkTaskInput)) body: z.infer<typeof bulkTaskInput>) {
    return this.tasks.bulk(this.ctx(a), body);
  }

  @Get('tasks/:id/activity')
  @ApiOperation({ summary: 'Task history (full history on Premium)' })
  activity(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.taskActivity(a.userId, id);
  }

  // ── Checklist ──
  @Post('tasks/:id/subtasks')
  @ApiZodBody(subtaskInput)
  addSubtask(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(subtaskInput)) body: z.infer<typeof subtaskInput>) {
    return this.extras.addSubtask(a.userId, id, body.title, a.sessionId);
  }

  @Patch('subtasks/:id')
  @ApiZodBody(subtaskUpdate)
  updateSubtask(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(subtaskUpdate)) body: z.infer<typeof subtaskUpdate>) {
    return this.extras.updateSubtask(a.userId, id, body, a.sessionId);
  }

  @Delete('subtasks/:id')
  deleteSubtask(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteSubtask(a.userId, id, a.sessionId);
  }

  // ── Reminders ──
  @Post('tasks/:id/reminders')
  @ApiZodBody(reminderInput)
  addReminder(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reminderInput)) body: z.infer<typeof reminderInput>) {
    return this.extras.addReminder(a.userId, id, body, a.sessionId);
  }

  @Delete('reminders/:id')
  deleteReminder(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteReminder(a.userId, id, a.sessionId);
  }

  // ── Comments ──
  @Get('tasks/:id/comments')
  comments(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.comments(a.userId, id);
  }

  @Post('tasks/:id/comments')
  @ApiZodBody(commentInput)
  addComment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentInput)) body: z.infer<typeof commentInput>) {
    return this.extras.addComment(a.userId, id, body.body, body.mentions, a.sessionId);
  }

  @Patch('comments/:id')
  @ApiZodBody(commentEdit)
  editComment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentEdit)) body: z.infer<typeof commentEdit>) {
    return this.extras.editComment(a.userId, id, body.body);
  }

  @Delete('comments/:id')
  deleteComment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteComment(a.userId, id);
  }

  // ── Attachments ──
  @Get('tasks/:id/attachments')
  attachments(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.attachments(a.userId, id);
  }

  @Post('tasks/:id/attachments')
  @ApiOperation({ summary: 'Start an upload; returns a short-lived signed PUT URL (daily attachment limit applies)' })
  @ApiZodBody(attachmentInput)
  createAttachment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(attachmentInput)) body: z.infer<typeof attachmentInput>) {
    return this.extras.createAttachment(a.userId, id, body);
  }

  @Post('attachments/:id/complete')
  @HttpCode(200)
  completeAttachment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.completeAttachment(a.userId, id, a.sessionId);
  }

  @Get('attachments/:id/url')
  @ApiOperation({ summary: 'Short-lived signed download URL' })
  attachmentUrl(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.attachmentUrl(a.userId, id);
  }

  @Delete('attachments/:id')
  deleteAttachment(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteAttachment(a.userId, id);
  }
}

/** Local-storage blob endpoint (used only when S3 is not configured). URLs are HMAC-signed and expire. */
@ApiTags('tasks')
@Controller('attachments')
export class AttachmentBlobController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private async verify(id: string, op: 'put' | 'get', exp: string, sig: string) {
    if (this.storage.driver !== 'local') throw Errors.notFound('Attachment');
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt || !this.storage.verifyLocal(a.storageKey, op, Number(exp), sig ?? '')) throw Errors.forbidden('Invalid or expired link');
    return a;
  }

  @Public()
  @Put(':id/blob')
  async upload(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Req() req: Request) {
    const a = await this.verify(id, 'put', exp, sig);
    if (a.status === 'READY') throw Errors.conflict('Already uploaded');
    const size = await this.storage.writeLocal(a.storageKey, req, this.env.MAX_ATTACHMENT_BYTES);
    return { ok: true, size };
  }

  @Public()
  @Get(':id/blob')
  async download(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const a = await this.verify(id, 'get', exp, sig);
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.readLocal(a.storageKey).pipe(res);
  }
}
