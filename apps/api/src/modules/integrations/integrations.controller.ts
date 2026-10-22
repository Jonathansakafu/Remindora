import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, Public } from '../../common/auth';
import { Errors } from '../../common/errors';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { ENV, type ServerEnv } from '../../config';
import { IntegrationsService, PROVIDERS, type ProviderKey } from './integrations.service';

const connectInput = z.object({ url: z.string().max(2000).optional(), databaseId: z.string().max(100).optional() });
const configInput = z.object({ databaseId: z.string().max(100).optional(), events: z.array(z.string()).max(10).optional() });
const subscribeInput = z.object({ name: z.string().trim().min(1).max(80), url: z.string().min(8).max(2000), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

function provider(key: string): ProviderKey {
  if (!(key in PROVIDERS)) throw Errors.notFound('Integration');
  return key as ProviderKey;
}

@ApiTags('integrations')
@Controller()
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  @Get('integrations')
  @ApiBearerAuth()
  list(@Auth() a: AuthContext) {
    return this.integrations.list(a.userId);
  }

  @Post('integrations/:provider/connect')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect an integration (OAuth URL, or store a webhook destination)' })
  @ApiZodBody(connectInput)
  connect(@Auth() a: AuthContext, @Param('provider') key: string, @Body(new ZodPipe(connectInput)) body: z.infer<typeof connectInput>) {
    return this.integrations.connect(a.userId, provider(key), body);
  }

  @Patch('integrations/:provider')
  @ApiBearerAuth()
  @ApiZodBody(configInput)
  configure(@Auth() a: AuthContext, @Param('provider') key: string, @Body(new ZodPipe(configInput)) body: z.infer<typeof configInput>) {
    return this.integrations.updateConfig(a.userId, provider(key), body);
  }

  @Delete('integrations/:provider')
  @ApiBearerAuth()
  disconnect(@Auth() a: AuthContext, @Param('provider') key: string) {
    return this.integrations.disconnect(a.userId, provider(key));
  }

  @Public()
  @Get('integrations/:provider/callback')
  async callback(@Param('provider') key: string, @Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      await this.integrations.callback(provider(key), code, state);
      res.redirect(302, `${this.env.WEB_URL}/app/settings/integrations?connected=${key}`);
    } catch {
      res.redirect(302, `${this.env.WEB_URL}/app/settings/integrations?error=${key}`);
    }
  }

  @Get('calendar-subscriptions')
  @ApiBearerAuth()
  subscriptions(@Auth() a: AuthContext) {
    return this.integrations.subscriptions(a.userId);
  }

  @Post('calendar-subscriptions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to an ICS feed (SSRF-protected fetch)' })
  @ApiZodBody(subscribeInput)
  subscribe(@Auth() a: AuthContext, @Body(new ZodPipe(subscribeInput)) body: z.infer<typeof subscribeInput>) {
    return this.integrations.subscribe(a.userId, body);
  }

  @Post('calendar-subscriptions/:id/refresh')
  @HttpCode(200)
  @ApiBearerAuth()
  refresh(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.refresh(a.userId, id);
  }

  @Delete('calendar-subscriptions/:id')
  @ApiBearerAuth()
  unsubscribe(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.unsubscribe(a.userId, id);
  }
}
