import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth } from '../../common/auth';
import { clientIp, userAgent, type AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { DevicesService } from './devices.service';

const renameInput = z.object({ name: z.string().trim().min(1).max(80) });
const pushInput = z.object({ provider: z.enum(['fcm', 'expo', 'webpush']), token: z.string().min(10).max(4000) });

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Linked Devices: name, OS, last active, current flag' })
  list(@Auth() a: AuthContext) {
    return this.devices.list(a.userId, a.deviceId);
  }

  @Patch(':id')
  @ApiZodBody(renameInput)
  rename(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(renameInput)) body: z.infer<typeof renameInput>) {
    return this.devices.rename(a.userId, id, body.name);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a device (remote sign-out, immediate)' })
  revoke(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.devices.revoke(a.userId, id, a.sessionId, { ip: clientIp(req), userAgent: userAgent(req) });
  }

  @Post('revoke-others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out every other device' })
  revokeOthers(@Auth() a: AuthContext, @Req() req: Request) {
    return this.devices.revokeOthers(a.userId, a.deviceId, a.sessionId, { ip: clientIp(req), userAgent: userAgent(req) });
  }

  @Post('current/push')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register this device for push (FCM / Expo / Web Push); stored encrypted' })
  @ApiZodBody(pushInput)
  registerPush(@Auth() a: AuthContext, @Body(new ZodPipe(pushInput)) body: z.infer<typeof pushInput>) {
    return this.devices.registerPush(a.userId, a.deviceId, body.provider, body.token);
  }

  @Delete('current/push')
  unregisterPush(@Auth() a: AuthContext) {
    return this.devices.unregisterPush(a.deviceId);
  }
}
