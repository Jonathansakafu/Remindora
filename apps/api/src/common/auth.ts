import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isRecentlyReauthenticated, sessionState, TokenError, verifyAccessToken } from '@remindora/auth';
import { KEYS, type Keys } from '../config';
import { Errors } from './errors';
import { PrismaService } from './prisma.service';
import type { AuthContext, AuthedRequest } from './request';

export const IS_PUBLIC = 'isPublic';
export const REQUIRES_REAUTH = 'requiresReauth';

/** Skips authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires a re-authentication (email code / native biometric-confirmed) within the last 5 minutes. */
export const RequireReauth = () => SetMetadata(REQUIRES_REAUTH, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().auth;
});

/**
 * Global guard: verifies the bearer access token and that the session and device
 * are still active. Revocation is therefore immediate, not "after token expiry".
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(KEYS) private readonly keys: Keys,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
    req.auth = await this.authenticate(header.slice(7));

    if (this.reflector.getAllAndOverride<boolean>(REQUIRES_REAUTH, targets) && !isRecentlyReauthenticated(req.auth.reauthAt)) {
      throw Errors.reauthRequired();
    }
    return true;
  }

  async authenticate(token: string): Promise<AuthContext> {
    let claims;
    try {
      claims = verifyAccessToken(this.keys.jwt, token);
    } catch (e) {
      throw Errors.unauthorized(e instanceof TokenError ? e.message : 'Invalid token', 'invalid_token');
    }
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid }, include: { device: { select: { revokedAt: true } } } });
    if (!session || session.userId !== claims.sub) throw Errors.unauthorized('Session not found', 'session_revoked');
    const state = sessionState(session, session.device);
    if (state !== 'active') throw Errors.unauthorized(`Session ${state}`, 'session_revoked');

    // Touch lastActiveAt at most once a minute to keep the Linked Devices list fresh without write amplification.
    if (Date.now() - session.lastActiveAt.getTime() > 60_000) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: now } }),
        this.prisma.device.update({ where: { id: session.deviceId }, data: { lastActiveAt: now } }),
      ]);
    }
    const reauthAt = session.reauthAt ? Math.floor(session.reauthAt.getTime() / 1000) : null;
    return { userId: session.userId, sessionId: session.id, deviceId: session.deviceId, reauthAt };
  }
}
