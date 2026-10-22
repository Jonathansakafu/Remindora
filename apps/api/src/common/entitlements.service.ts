import { Injectable } from '@nestjs/common';
import {
  checkLimit,
  effectivePlan,
  hasFeature,
  LIMIT_LABELS,
  resolveEntitlements,
  type FeatureKey,
  type LimitKey,
  type ResolvedEntitlements,
} from '@remindora/entitlements';
import type { PlanKey } from '@remindora/types';
import { Errors } from './errors';
import { PrismaService } from './prisma.service';

const CACHE_MS = 30_000;

/**
 * Server-authoritative entitlements. Clients only *display* gating; every limit
 * and premium feature is enforced here. Values come from the Entitlement and
 * FeatureFlag tables (editable via the admin API) so they change without app updates.
 */
@Injectable()
export class EntitlementsService {
  private cache = new Map<string, { at: number; value: ResolvedEntitlements; status: string; periodEnd: Date | null }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  async forUser(userId: string): Promise<ResolvedEntitlements & { status: string; currentPeriodEnd: Date | null }> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, status: hit.status, currentPeriodEnd: hit.periodEnd };

    const sub = await this.prisma.subscription.findFirst({
      where: { userId, workspaceId: null },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const plan: PlanKey = effectivePlan(sub);
    const [rows, flags] = await Promise.all([
      this.prisma.entitlement.findMany({ where: { OR: [{ plan, userId: null }, { userId }] } }),
      this.prisma.featureFlag.findMany(),
    ]);
    const value = resolveEntitlements({ userId, plan, rows, flags });
    const status = sub ? sub.status : 'NONE';
    this.cache.set(userId, { at: Date.now(), value, status, periodEnd: sub?.currentPeriodEnd ?? null });
    return { ...value, status, currentPeriodEnd: sub?.currentPeriodEnd ?? null };
  }

  /** Workspace-scoped limits (lists, tasks per list, members) follow the workspace owner's plan. */
  async forWorkspaceOwner(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerId: true } });
    return this.forUser(ws.ownerId);
  }

  async assertLimit(ent: ResolvedEntitlements, key: LimitKey, current: number, adding = 1) {
    const result = checkLimit(ent, key, current, adding);
    if (!result.ok) throw Errors.planLimit(key, result.limit, LIMIT_LABELS[key]);
  }

  async assertFeature(userId: string, feature: FeatureKey) {
    const ent = await this.forUser(userId);
    if (!hasFeature(ent, feature)) throw Errors.planFeature(feature);
    return ent;
  }

  async has(userId: string, feature: FeatureKey) {
    return hasFeature(await this.forUser(userId), feature);
  }
}
