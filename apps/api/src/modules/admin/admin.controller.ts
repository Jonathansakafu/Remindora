import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, Injectable, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, LIMIT_KEYS } from '@remindora/entitlements';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { Auth } from '../../common/auth';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import type { AuthContext, AuthedRequest } from '../../common/request';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { RealtimeService } from '../../realtime/realtime.service';

@Injectable()
class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.prisma.user.findUnique({ where: { id: req.auth.userId }, select: { isAdmin: true } });
    if (!user?.isAdmin) throw Errors.notFound('Endpoint');
    return true;
  }
}

const key = z.enum([...LIMIT_KEYS, ...FEATURE_KEYS] as [string, ...string[]]);
const entitlementInput = z.object({
  plan: z.enum(['FREE', 'PREMIUM', 'TEAM']).nullable().default(null),
  userId: z.uuid().nullable().default(null),
  key,
  limit: z.number().int().min(0).max(100_000).nullable().default(null),
  enabled: z.boolean().nullable().default(null),
  note: z.string().max(200).optional(),
}).refine((v) => (v.plan === null) !== (v.userId === null), 'Set exactly one of plan or userId');
const flagInput = z.object({
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100).default(100),
  plans: z.array(z.enum(['FREE', 'PREMIUM', 'TEAM'])).default([]),
  allowUserIds: z.array(z.uuid()).default([]),
  description: z.string().max(200).optional(),
});

/** Runtime control over plans and features — no app release needed. */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('entitlements')
  list() {
    return this.prisma.entitlement.findMany({ orderBy: [{ plan: 'asc' }, { key: 'asc' }] });
  }

  @Put('entitlements')
  @ApiOperation({ summary: 'Upsert a plan default or per-user override' })
  @ApiZodBody(entitlementInput)
  async upsert(@Auth() a: AuthContext, @Body(new ZodPipe(entitlementInput)) body: z.infer<typeof entitlementInput>) {
    const where = body.userId ? { userId: body.userId, key: body.key } : { plan: body.plan, userId: null, key: body.key };
    const existing = await this.prisma.entitlement.findFirst({ where });
    const row = existing
      ? await this.prisma.entitlement.update({ where: { id: existing.id }, data: { limit: body.limit, enabled: body.enabled, note: body.note } })
      : await this.prisma.entitlement.create({ data: { plan: body.plan, userId: body.userId, key: body.key, limit: body.limit, enabled: body.enabled, note: body.note } });
    this.entitlements.invalidate(body.userId ?? undefined);
    if (body.userId) this.realtime.toUser(body.userId, 'entitlements.changed', {});
    await this.audit.log({ action: 'admin.entitlement_changed', actorId: a.userId, metadata: { ...body } });
    return row;
  }

  @Delete('entitlements/:id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.prisma.entitlement.delete({ where: { id } });
    this.entitlements.invalidate();
    await this.audit.log({ action: 'admin.entitlement_deleted', actorId: a.userId, targetId: id });
    return { ok: true };
  }

  @Get('flags')
  flags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('flags/:key')
  @ApiOperation({ summary: 'Kill switch / staged rollout for a feature' })
  @ApiZodBody(flagInput)
  async setFlag(@Auth() a: AuthContext, @Param('key') flagKey: string, @Body(new ZodPipe(flagInput)) body: z.infer<typeof flagInput>) {
    const row = await this.prisma.featureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...body }, update: body });
    this.entitlements.invalidate();
    await this.audit.log({ action: 'admin.flag_changed', actorId: a.userId, targetId: flagKey, metadata: { ...body } });
    return row;
  }
}
