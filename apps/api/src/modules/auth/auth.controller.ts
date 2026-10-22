import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { deviceInfoInput, emailStartInput, isValidTimezone } from '@remindora/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth, Public } from '../../common/auth';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RateLimit } from '../../common/rate-limit';
import { clientIp, userAgent, type AuthContext } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { ENV, type ServerEnv } from '../../config';
import { AuthService, toUserDTO, type RequestMeta } from './auth.service';
import { OAuthService } from './oauth.service';
import { clearRefreshCookie, readRefreshCookie, requireCsrfHeader, setRefreshCookie } from './cookies';

const verifyInput = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  pollSecret: z.string().min(10).max(100),
});
const magicInput = z.object({ challengeId: z.uuid(), token: z.string().min(20).max(200) });
const pollInput = z.object({ pollSecret: z.string().min(10).max(100) });
const decideInput = z.object({ approve: z.boolean() });
const refreshInput = z.object({ refreshToken: z.string().min(20).max(200).optional() });
const reauthVerifyInput = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) });
const biometricVerifyInput = z.object({ nonce: z.string().min(10).max(100), signature: z.string().regex(/^[0-9a-f]{64}$/) });
const exchangeInput = z.object({ code: z.string().min(10).max(100) });
const updateMeInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
    locale: z.string().min(2).max(20),
    weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    theme: z.string().max(40),
    requireDeviceApproval: z.boolean(),
  })
  .partial();
const oauthStartQuery = z.object({
  platform: deviceInfoInput.shape.platform.default('WEB'),
  deviceName: z.string().max(80).default('Web browser'),
  native: z.enum(['0', '1']).default('0'),
});

function meta(req: Request): RequestMeta {
  return { ip: clientIp(req), userAgent: userAgent(req) };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** Web clients get the refresh token as an httpOnly cookie; native clients keep it in secure storage. */
  private deliver<T extends { refreshToken?: string }>(res: Response, tokens: T, platform: string): Omit<T, 'refreshToken'> | T {
    if (platform === 'WEB' && tokens.refreshToken) {
      setRefreshCookie(res, tokens.refreshToken, this.env);
      const { refreshToken: _omit, ...rest } = tokens;
      return rest;
    }
    return tokens;
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Sign-in methods enabled on this server' })
  providers() {
    return { email: true, oauth: this.oauth.enabledProviders() };
  }

  @Public()
  @Post('email/start')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 600, by: 'ip', name: 'email-start' })
  @ApiOperation({ summary: 'Send a 6-digit code + magic link (10 min, single use)' })
  @ApiZodBody(emailStartInput)
  start(@Body(new ZodPipe(emailStartInput)) body: z.infer<typeof emailStartInput>, @Req() req: Request) {
    return this.auth.startEmail(body.email, body.device, meta(req), body.redirectTo);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSeconds: 600, by: 'ip', name: 'email-verify' })
  @ApiOperation({ summary: 'Verify the 6-digit code on the requesting device' })
  @ApiZodBody(verifyInput)
  async verify(@Body(new ZodPipe(verifyInput)) body: z.infer<typeof verifyInput>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyCode(body.challengeId, body.code, body.pollSecret, meta(req));
    if (result.status !== 'signed_in') return result;
    return { status: result.status, tokens: this.deliver(res, result.tokens, await this.platformOf(result.tokens.deviceId)) };
  }

  @Public()
  @Post('email/magic')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSeconds: 600, by: 'ip', name: 'email-verify' })
  @ApiOperation({ summary: 'Verify a magic link; the requesting device then redeems by polling' })
  @ApiZodBody(magicInput)
  magic(@Body(new ZodPipe(magicInput)) body: z.infer<typeof magicInput>, @Req() req: Request) {
    return this.auth.verifyMagicLink(body.challengeId, body.token, meta(req));
  }

  @Public()
  @Post('email/challenges/:id/poll')
  @HttpCode(200)
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', name: 'email-poll' })
  @ApiOperation({ summary: 'Requesting device polls a challenge; returns tokens once verified/approved' })
  @ApiZodBody(pollInput)
  async poll(@Param('id') id: string, @Body(new ZodPipe(pollInput)) body: z.infer<typeof pollInput>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.pollChallenge(id, body.pollSecret, meta(req));
    if (result.status !== 'signed_in') return result;
    return { status: result.status, tokens: this.deliver(res, result.tokens, await this.platformOf(result.tokens.deviceId)) };
  }

  @Post('email/challenges/:id/decide')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a sign-in from a new device (sensitive sign-ins)' })
  @ApiZodBody(decideInput)
  decide(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(decideInput)) body: z.infer<typeof decideInput>, @Req() req: Request) {
    return this.auth.decideChallenge(a.userId, a.sessionId, id, body.approve, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'ip', name: 'refresh' })
  @ApiOperation({ summary: 'Rotate the refresh token (cookie for web, body for native)' })
  @ApiZodBody(refreshInput)
  async refresh(@Body(new ZodPipe(refreshInput)) body: z.infer<typeof refreshInput>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const fromCookie = !body.refreshToken;
    if (fromCookie) requireCsrfHeader(req, this.env);
    const token = body.refreshToken ?? readRefreshCookie(req);
    if (!token) throw Errors.unauthorized('No session', 'no_session');
    try {
      const tokens = await this.auth.refresh(token, meta(req));
      return fromCookie ? this.deliver(res, tokens, 'WEB') : tokens;
    } catch (e) {
      if (fromCookie) clearRefreshCookie(res, this.env);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out this device (revokes its session immediately)' })
  async logout(@Auth() a: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.userId, a.sessionId, meta(req));
    clearRefreshCookie(res, this.env);
    return { ok: true };
  }

  @Post('reauth/start')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Email a code to confirm a sensitive action' })
  reauthStart(@Auth() a: AuthContext, @Req() req: Request) {
    return this.auth.startReauth(a.userId, a.sessionId, meta(req));
  }

  @Post('reauth/verify')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiZodBody(reauthVerifyInput)
  reauthVerify(@Auth() a: AuthContext, @Body(new ZodPipe(reauthVerifyInput)) body: z.infer<typeof reauthVerifyInput>, @Req() req: Request) {
    return this.auth.verifyReauth(a.userId, a.sessionId, body.challengeId, body.code, meta(req));
  }

  @Post('reauth/biometric/enroll')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Native: enrol a biometric-gated re-auth secret for this device' })
  enrollBiometric(@Auth() a: AuthContext) {
    return this.auth.enrollBiometric(a.userId, a.sessionId, a.deviceId);
  }

  @Post('reauth/biometric/challenge')
  @HttpCode(200)
  @ApiBearerAuth()
  biometricChallenge(@Auth() a: AuthContext) {
    return this.auth.biometricChallenge(a.deviceId);
  }

  @Post('reauth/biometric/verify')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Native: prove biometric unlock with HMAC(secret, nonce)' })
  @ApiZodBody(biometricVerifyInput)
  biometricVerify(@Auth() a: AuthContext, @Body(new ZodPipe(biometricVerifyInput)) body: z.infer<typeof biometricVerifyInput>, @Req() req: Request) {
    return this.auth.verifyBiometric(a.userId, a.sessionId, a.deviceId, body.nonce, body.signature, meta(req));
  }

  @Public()
  @Get('oauth/:provider/start')
  @RateLimit({ limit: 30, windowSeconds: 600, by: 'ip', name: 'oauth' })
  @ApiOperation({ summary: 'Redirect to the OAuth provider (PKCE)' })
  async oauthStart(@Param('provider') provider: string, @Query(new ZodPipe(oauthStartQuery)) q: z.infer<typeof oauthStartQuery>, @Res() res: Response) {
    const url = await this.oauth.start(provider, { name: q.deviceName, platform: q.platform }, q.native === '1');
    res.redirect(302, url);
  }

  @Public()
  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'OAuth provider callback' })
  async oauthCallback(@Param('provider') provider: string, @Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    try {
      if (!code || !state) throw Errors.badRequest('Missing code', 'oauth_state');
      const { tokens, native } = await this.oauth.callback(provider, code, state, meta(req));
      if (native) {
        const exchange = await this.oauth.createExchangeCode(tokens);
        return res.redirect(302, `${this.env.APP_DEEP_LINK_SCHEME}://auth/callback?code=${encodeURIComponent(exchange)}`);
      }
      setRefreshCookie(res, tokens.refreshToken!, this.env);
      return res.redirect(302, `${this.env.WEB_URL}/app/today`);
    } catch (e) {
      const code = (e as { response?: { code?: string } }).response?.code ?? 'oauth_failed';
      return res.redirect(302, `${this.env.WEB_URL}/login?error=${encodeURIComponent(code)}`);
    }
  }

  @Public()
  @Post('oauth/exchange')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSeconds: 600, by: 'ip', name: 'oauth' })
  @ApiZodBody(exchangeInput)
  exchange(@Body(new ZodPipe(exchangeInput)) body: z.infer<typeof exchangeInput>) {
    return this.oauth.exchange(body.code);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user' })
  async me(@Auth() a: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    return { ...toUserDTO(user), requireDeviceApproval: user.requireDeviceApproval, sessionId: a.sessionId, deviceId: a.deviceId };
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiZodBody(updateMeInput)
  async updateMe(@Auth() a: AuthContext, @Body(new ZodPipe(updateMeInput)) body: z.infer<typeof updateMeInput>) {
    const user = await this.prisma.user.update({ where: { id: a.userId }, data: body });
    return { ...toUserDTO(user), requireDeviceApproval: user.requireDeviceApproval };
  }

  private async platformOf(deviceId: string) {
    const d = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { platform: true } });
    return d?.platform ?? 'WEB';
  }
}
