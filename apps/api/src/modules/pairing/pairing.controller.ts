import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { deviceInfoInput } from '@remindora/types';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, Public, RequireReauth } from '../../common/auth';
import { Errors } from '../../common/errors';
import { RateLimit } from '../../common/rate-limit';
import { clientIp, userAgent, type AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { PairingService } from './pairing.service';

const claimInput = z.object({ token: z.string().min(20).max(400), device: deviceInfoInput });
const decideInput = z.object({ approve: z.boolean() });
const completeInput = z.object({ claimSecret: z.string().min(20).max(100) });

@ApiTags('device-linking')
@Controller('pairing')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  @Post()
  @HttpCode(201)
  @RequireReauth()
  @RateLimit({ limit: 10, windowSeconds: 3600, by: 'user', name: 'pairing-create' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a single-use, encrypted QR pairing token (60 s). Requires recent re-auth.' })
  create(@Auth() a: AuthContext, @Req() req: Request) {
    return this.pairing.create(a, { ip: clientIp(req), userAgent: userAgent(req) });
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiator polls pairing status (fallback when realtime is unavailable)' })
  status(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.pairing.statusForInitiator(a, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiator explicitly approves or rejects the claiming device' })
  @ApiZodBody(decideInput)
  decide(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decideInput)) body: z.infer<typeof decideInput>, @Req() req: Request) {
    return this.pairing.decide(a, id, body.approve, { ip: clientIp(req), userAgent: userAgent(req) });
  }

  @Public()
  @Post('claim')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 600, by: 'ip', name: 'pairing-claim' })
  @ApiOperation({ summary: 'New device claims a scanned QR token (single use)' })
  @ApiZodBody(claimInput)
  claim(@Body(new ZodPipe(claimInput)) body: z.infer<typeof claimInput>, @Req() req: Request) {
    return this.pairing.claim(body.token, body.device, { ip: clientIp(req), userAgent: userAgent(req) });
  }

  @Public()
  @Get('claim/:id/status')
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', name: 'pairing-status' })
  @ApiOperation({ summary: 'Claiming device polls for approval (x-claim-secret header)' })
  claimStatus(@Param('id', ParseUUIDPipe) id: string, @Headers('x-claim-secret') secret: string | undefined) {
    if (!secret) throw Errors.unauthorized('Missing claim secret');
    return this.pairing.statusForClaimant(id, secret);
  }

  @Public()
  @Post('claim/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claiming device redeems the approved pairing for its own session' })
  @ApiZodBody(completeInput)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(completeInput)) body: z.infer<typeof completeInput>, @Req() req: Request) {
    return this.pairing.complete(id, body.claimSecret, { ip: clientIp(req), userAgent: userAgent(req) });
  }
}
