import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { WellbeingService } from './wellbeing.service';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const habitInput = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(40).nullish(),
  color: color.optional(),
  frequency: z.enum(['DAILY', 'WEEKLY']).default('DAILY'),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  targetPerPeriod: z.number().int().min(1).max(7).default(1),
  reminderTime: clock.nullish(),
});
const habitUpdate = habitInput.partial().extend({ archived: z.boolean().optional(), sortOrder: z.number().optional(), reminderTime: clock.nullable().optional(), icon: z.string().max(40).nullable().optional() });
const checkInInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), done: z.boolean().default(true) });
const focusStart = z.object({ taskId: z.uuid().nullish(), kind: z.enum(['FOCUS', 'SHORT_BREAK', 'LONG_BREAK']).default('FOCUS'), plannedMinutes: z.number().int().min(1).max(240) });
const focusFinish = z.object({ completed: z.boolean(), actualSeconds: z.number().int().min(0).max(4 * 3600).optional() });
const countdownInput = z.object({ title: z.string().trim().min(1).max(80), targetAt: z.iso.datetime({ offset: true }), color: color.optional(), icon: z.string().max(40).nullish() });
const countdownUpdate = countdownInput.partial().extend({ icon: z.string().max(40).nullable().optional() });

@ApiTags('focus-habits')
@ApiBearerAuth()
@Controller()
export class WellbeingController {
  constructor(private readonly svc: WellbeingService) {}

  @Get('habits')
  habits(@Auth() a: AuthContext, @Query('archived') archived?: string) {
    return this.svc.habits(a.userId, archived === 'true');
  }

  @Post('habits')
  @ApiZodBody(habitInput)
  createHabit(@Auth() a: AuthContext, @Body(new ZodPipe(habitInput)) body: z.infer<typeof habitInput>) {
    return this.svc.createHabit(a.userId, body);
  }

  @Patch('habits/:id')
  @ApiZodBody(habitUpdate)
  updateHabit(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(habitUpdate)) body: z.infer<typeof habitUpdate>) {
    return this.svc.updateHabit(a.userId, id, body);
  }

  @Delete('habits/:id')
  deleteHabit(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteHabit(a.userId, id);
  }

  @Post('habits/:id/check-in')
  @HttpCode(200)
  @ApiZodBody(checkInInput)
  checkIn(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(checkInInput)) body: z.infer<typeof checkInInput>) {
    return this.svc.checkIn(a.userId, id, body.date, body.done);
  }

  @Get('habits/:id/stats')
  habitStats(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.habitStats(a.userId, id);
  }

  @Post('focus/start')
  @ApiZodBody(focusStart)
  startFocus(@Auth() a: AuthContext, @Body(new ZodPipe(focusStart)) body: z.infer<typeof focusStart>) {
    return this.svc.startFocus(a.userId, body);
  }

  @Post('focus/:id/finish')
  @HttpCode(200)
  @ApiZodBody(focusFinish)
  finishFocus(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(focusFinish)) body: z.infer<typeof focusFinish>) {
    return this.svc.finishFocus(a.userId, id, body);
  }

  @Get('focus')
  focus(@Auth() a: AuthContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.focusSessions(a.userId, from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000), to ? new Date(to) : new Date());
  }

  @Get('focus/stats')
  focusStats(@Auth() a: AuthContext) {
    return this.svc.focusStats(a.userId);
  }

  @Get('countdowns')
  countdowns(@Auth() a: AuthContext) {
    return this.svc.countdowns(a.userId);
  }

  @Post('countdowns')
  @ApiZodBody(countdownInput)
  createCountdown(@Auth() a: AuthContext, @Body(new ZodPipe(countdownInput)) body: z.infer<typeof countdownInput>) {
    return this.svc.createCountdown(a.userId, body);
  }

  @Patch('countdowns/:id')
  @ApiZodBody(countdownUpdate)
  updateCountdown(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(countdownUpdate)) body: z.infer<typeof countdownUpdate>) {
    return this.svc.updateCountdown(a.userId, id, body);
  }

  @Delete('countdowns/:id')
  deleteCountdown(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCountdown(a.userId, id);
  }
}
