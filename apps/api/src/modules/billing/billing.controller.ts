import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, Public } from '../../common/auth';
import { Errors } from '../../common/errors';
import type { AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { BillingService } from './billing.service';

const checkoutInput = z.object({ plan: z.enum(['PREMIUM', 'TEAM']), interval: z.enum(['month', 'year']).default('month') });
const devInput = z.object({ plan: z.enum(['FREE', 'PREMIUM', 'TEAM']), interval: z.enum(['month', 'year']).default('month') });

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('billing/plans')
  @ApiOperation({ summary: 'Plan catalog with live limits (served from the database)' })
  plans() {
    return this.billing.plans();
  }

  @Get('me/entitlements')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Server-authoritative plan, limits and features for this user' })
  entitlements(@Auth() a: AuthContext) {
    return this.billing.entitlementsFor(a.userId);
  }

  @Get('me/usage')
  @ApiBearerAuth()
  usage(@Auth() a: AuthContext) {
    return this.billing.usage(a.userId);
  }

  @Post('billing/checkout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiZodBody(checkoutInput)
  checkout(@Auth() a: AuthContext, @Body(new ZodPipe(checkoutInput)) body: z.infer<typeof checkoutInput>) {
    return this.billing.checkout(a.userId, body.plan, body.interval);
  }

  @Post('billing/portal')
  @HttpCode(200)
  @ApiBearerAuth()
  portal(@Auth() a: AuthContext) {
    return this.billing.portal(a.userId);
  }

  @Post('billing/dev/activate')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Development only (DEV_TOOLS=true): switch plans without payment' })
  @ApiZodBody(devInput)
  devActivate(@Auth() a: AuthContext, @Body(new ZodPipe(devInput)) body: z.infer<typeof devInput>) {
    return this.billing.devActivate(a.userId, body.plan, body.interval);
  }

  @Public()
  @Post('billing/webhook/:provider')
  @HttpCode(200)
  @ApiOperation({ summary: 'Billing provider webhook (signature-verified, idempotent)' })
  webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (provider !== this.billing.provider.name) throw Errors.notFound('Webhook');
    if (!req.rawBody) throw Errors.badRequest('Missing body');
    return this.billing.webhook(req.rawBody, req.headers);
  }
}
