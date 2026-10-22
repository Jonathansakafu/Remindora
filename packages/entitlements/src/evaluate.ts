import { createHash } from 'node:crypto';
import type { PlanKey } from '@remindora/types';
import { FEATURE_KEYS, LIMIT_KEYS, PLAN_DEFAULTS, type FeatureKey, type LimitKey, type PlanDefinition } from './catalog';

/** A row from the Entitlement table: plan-wide (userId null) or a per-user override. */
export interface EntitlementRow {
  plan: PlanKey | null;
  userId: string | null;
  key: string;
  limit: number | null;
  enabled: boolean | null;
}

/** A row from the FeatureFlag table: global kill switch / staged rollout. */
export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  plans: string[];
  allowUserIds: string[];
}

export interface SubscriptionLike {
  plan: PlanKey;
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  currentPeriodEnd: Date | null;
}

export interface ResolvedEntitlements {
  plan: PlanKey;
  limits: Record<LimitKey, number>;
  features: Record<FeatureKey, boolean>;
}

/** Grace period for PAST_DUE subscriptions before they fall back to Free. */
export const PAST_DUE_GRACE_DAYS = 7;

export function effectivePlan(sub: SubscriptionLike | null | undefined, now = new Date()): PlanKey {
  if (!sub) return 'FREE';
  const periodOk = !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > now.getTime();
  if ((sub.status === 'ACTIVE' || sub.status === 'TRIALING') && periodOk) return sub.plan;
  if (sub.status === 'CANCELED' && periodOk) return sub.plan; // paid through period end
  if (sub.status === 'PAST_DUE' && sub.currentPeriodEnd && now.getTime() - sub.currentPeriodEnd.getTime() < PAST_DUE_GRACE_DAYS * 86_400_000) return sub.plan;
  return 'FREE';
}

/** Deterministic 0–99 bucket so a user stays in or out of a rollout consistently. */
export function rolloutBucket(flagKey: string, userId: string): number {
  const h = createHash('sha256').update(`${flagKey}:${userId}`).digest();
  return h.readUInt32BE(0) % 100;
}

export function flagAllows(flag: FeatureFlagRow, userId: string, plan: PlanKey): boolean {
  if (flag.allowUserIds.includes(userId)) return true;
  if (!flag.enabled) return false;
  if (flag.plans.length && !flag.plans.includes(plan)) return false;
  return rolloutBucket(flag.key, userId) < flag.rolloutPercent;
}

/**
 * Resolution order (later wins): code defaults → DB plan rows → DB per-user rows.
 * Feature flags then act as a global gate: a feature whose flag is off is off for
 * everyone, regardless of plan.
 */
export function resolveEntitlements(input: {
  userId: string;
  plan: PlanKey;
  rows: EntitlementRow[];
  flags: FeatureFlagRow[];
}): ResolvedEntitlements {
  const base: PlanDefinition = PLAN_DEFAULTS[input.plan];
  const limits = { ...base.limits };
  const features = { ...base.features };

  const apply = (row: EntitlementRow) => {
    if ((LIMIT_KEYS as readonly string[]).includes(row.key) && row.limit !== null) limits[row.key as LimitKey] = row.limit;
    if ((FEATURE_KEYS as readonly string[]).includes(row.key) && row.enabled !== null) features[row.key as FeatureKey] = row.enabled;
  };
  input.rows.filter((r) => r.userId === null && r.plan === input.plan).forEach(apply);
  input.rows.filter((r) => r.userId === input.userId).forEach(apply);

  for (const flag of input.flags) {
    if ((FEATURE_KEYS as readonly string[]).includes(flag.key) && !flagAllows(flag, input.userId, input.plan)) {
      features[flag.key as FeatureKey] = false;
    }
  }
  return { plan: input.plan, limits, features };
}

export type LimitCheck = { ok: true; limit: number; remaining: number } | { ok: false; limit: number; remaining: 0; key: LimitKey };

export function checkLimit(ent: ResolvedEntitlements, key: LimitKey, currentCount: number, adding = 1): LimitCheck {
  const limit = ent.limits[key];
  if (currentCount + adding > limit) return { ok: false, limit, remaining: 0, key };
  return { ok: true, limit, remaining: limit - currentCount - adding };
}

export function hasFeature(ent: ResolvedEntitlements, key: FeatureKey): boolean {
  return ent.features[key] === true;
}
