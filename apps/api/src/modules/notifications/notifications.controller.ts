import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { notificationPreferenceInput, PRIORITIES } from '@remindora/types';
import { z } from 'zod';
import { Auth } from '../../common/auth';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { TasksService } from '../tasks/tasks.service';
import { NotificationsService } from './notifications.service';

const actionInput = z.object({
  action: z.enum(['acknowledge', 'complete', 'snooze', 'stop', 'reschedule']),
  snoozeMinutes: z.number().int().min(1).max(1440).optional(),
  rescheduleTo: z.iso.datetime({ offset: true }).optional(),
});
const prefsInput = notificationPreferenceInput.extend({ lowPriorityMode: z.enum(['inbox', 'digest']).optional() });
const overrideInput = z.object({
  muted: z.boolean().optional(),
  channels: z.object({ push: z.boolean(), desktop: z.boolean(), webPush: z.boolean(), email: z.boolean(), inApp: z.boolean() }).partial().nullable().optional(),
  criticalRepeatMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  highRepeatMinutes: z.number().int().min(5).max(1440).nullable().optional(),
});
const deliveredInput = z.object({ channel: z.enum(['PUSH', 'DESKTOP', 'WEB_PUSH', 'IN_APP']) });
const testInput = z.object({ priority: z.enum(PRIORITIES as [string, ...string[]]).default('HIGH') });

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Notification center' })
  list(@Auth() a: AuthContext, @Query('unread') unread?: string, @Query('limit') limit?: string, @Query('before') before?: string) {
    return this.notifications.list(a.userId, { unreadOnly: unread === 'true', limit: Number(limit) || 50, before });
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Auth() a: AuthContext) {
    return this.notifications.readAll(a.userId);
  }

  @Get('preferences')
  preferences(@Auth() a: AuthContext) {
    return this.notifications.preferences(a.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Channels, repeat intervals, max re-alerts, quiet hours, timezone, weekends, digests' })
  @ApiZodBody(prefsInput)
  updatePreferences(@Auth() a: AuthContext, @Body(new ZodPipe(prefsInput)) body: z.infer<typeof prefsInput>) {
    return this.notifications.updatePreferences(a.userId, body);
  }

  @Put('preferences/projects/:projectId')
  @ApiOperation({ summary: 'Per-project override (mute, channels, intervals)' })
  @ApiZodBody(overrideInput)
  setOverride(@Auth() a: AuthContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Body(new ZodPipe(overrideInput)) body: z.infer<typeof overrideInput>) {
    return this.notifications.setProjectOverride(a.userId, projectId, body);
  }

  @Delete('preferences/projects/:projectId')
  clearOverride(@Auth() a: AuthContext, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.notifications.clearProjectOverride(a.userId, projectId);
  }

  @Get('events')
  @ApiOperation({ summary: 'Delivery log: scheduled, delivered, opened, snoozed, failed, acknowledged, completed' })
  events(@Auth() a: AuthContext, @Query('limit') limit?: string) {
    return this.notifications.events(a.userId, Number(limit) || 100);
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test notification through your enabled channels' })
  @ApiZodBody(testInput)
  async test(@Auth() a: AuthContext, @Body(new ZodPipe(testInput)) body: z.infer<typeof testInput>) {
    const n = await this.notifications.createInApp(a.userId, {
      kind: 'TEST',
      priority: body.priority as 'HIGH',
      title: 'Test notification',
      body: `This is how a ${body.priority.toLowerCase()} priority alert looks.`,
      push: true,
    });
    return { id: n.id };
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(a.userId, id, a.deviceId);
  }

  @Post(':id/delivered')
  @HttpCode(200)
  @ApiOperation({ summary: 'Client receipt confirmation (delivery metrics)' })
  @ApiZodBody(deliveredInput)
  delivered(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deliveredInput)) body: z.infer<typeof deliveredInput>) {
    return this.notifications.delivered(a.userId, id, a.deviceId, body.channel);
  }

  @Post(':id/action')
  @HttpCode(200)
  @ApiOperation({ summary: 'One-tap Snooze / Complete / Reschedule / Stop reminders / Acknowledge — resolves on every device' })
  @ApiZodBody(actionInput)
  async action(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(actionInput)) body: z.infer<typeof actionInput>) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: a.userId } });
    if (!n) throw Errors.notFound('Notification');
    const ctx = { userId: a.userId, sessionId: a.sessionId, deviceId: a.deviceId };
    if (body.action === 'complete') {
      if (!n.taskId) throw Errors.badRequest('Nothing to complete');
      await this.tasks.complete(ctx, n.taskId);
    }
    if (body.action === 'reschedule') {
      if (!n.taskId || !body.rescheduleTo) throw Errors.badRequest('rescheduleTo is required');
      await this.tasks.update(ctx, n.taskId, { dueAt: body.rescheduleTo, force: true });
    }
    return this.notifications.applyAction(a.userId, a.deviceId, id, body.action, {
      snoozeMinutes: body.snoozeMinutes,
      rescheduleTo: body.rescheduleTo ? new Date(body.rescheduleTo) : undefined,
    });
  }
}
