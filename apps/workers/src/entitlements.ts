import { effectivePlan, resolveEntitlements } from '@remindora/entitlements';
import type { PrismaClient } from '@remindora/database';

export async function entitlementsFor(prisma: PrismaClient, userId: string) {
  const sub = await prisma.subscription.findFirst({ where: { userId, workspaceId: null }, orderBy: { updatedAt: 'desc' } });
  const plan = effectivePlan(sub);
  const [rows, flags] = await Promise.all([prisma.entitlement.findMany({ where: { OR: [{ plan, userId: null }, { userId }] } }), prisma.featureFlag.findMany()]);
  return resolveEntitlements({ userId, plan, rows, flags });
}
