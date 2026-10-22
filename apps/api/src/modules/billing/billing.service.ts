import { Inject, Injectable, Logger } from '@nestjs/common';
import { FEATURE_KEYS, LIMIT_KEYS, PLAN_DEFAULTS, resolveEntitlements } from '@remindora/entitlements';
import type { EntitlementsDTO, PlanKey } from '@remindora/types';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ENV, type ServerEnv } from '../../config';
import { RealtimeService } from '../../realtime/realtime.service';
import { DevBillingProvider, StripeBillingProvider, type BillingProvider, type Interval, type NormalizedSubscription } from './providers';

export const PRICES = {
  PREMIUM: { month: 4.99, year: 35.99, currency: 'USD' },
  TEAM: { month: 7.99, year: 79.99, currency: 'USD', perSeat: true },
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');
  readonly provider: BillingProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {
    this.provider = env.BILLING_PROVIDER === 'stripe' ? new StripeBillingProvider(env) : new DevBillingProvider(env);
  }

  /** Plan catalog with the *live* limits from the database. */
  async plans() {
    const [rows, flags] = await Promise.all([this.prisma.entitlement.findMany({ where: { userId: null } }), this.prisma.featureFlag.findMany()]);
    const plans = (['FREE', 'PREMIUM', 'TEAM'] as PlanKey[]).map((plan) => {
      const r = resolveEntitlements({ userId: 'catalog', plan, rows, flags: flags.map((f) => ({ ...f, allowUserIds: [] })) });
      return { plan, price: plan === 'FREE' ? null : PRICES[plan], limits: r.limits, features: r.features };
    });
    return { provider: this.provider.name, plans, limitKeys: LIMIT_KEYS, featureKeys: FEATURE_KEYS };
  }

  async entitlementsFor(userId: string): Promise<EntitlementsDTO> {
    const e = await this.entitlements.forUser(userId);
    return { plan: e.plan, status: e.status, currentPeriodEnd: e.currentPeriodEnd?.toISOString() ?? null, limits: e.limits, features: e.features };
  }

  async usage(userId: string) {
    const ws = await this.prisma.workspace.findMany({ where: { ownerId: userId, deletedAt: null }, select: { id: true } });
    const [lists, habits, countdowns, filters, templates] = await Promise.all([
      this.prisma.project.count({ where: { workspaceId: { in: ws.map((w) => w.id) }, deletedAt: null, isInbox: false } }),
      this.prisma.habit.count({ where: { userId, deletedAt: null } }),
      this.prisma.countdown.count({ where: { userId, deletedAt: null } }),
      this.prisma.savedFilter.count({ where: { userId } }),
      this.prisma.template.count({ where: { userId } }),
    ]);
    return { 'lists.max': lists, 'habits.max': habits, 'countdowns.max': countdowns, 'savedFilters.max': filters, 'templates.max': templates };
  }

  async checkout(userId: string, plan: PlanKey, interval: Interval) {
    if (plan === 'FREE') throw Errors.badRequest('Pick a paid plan');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { url } = await this.provider.createCheckout({
      userId,
      email: user.email,
      plan,
      interval,
      successUrl: `${this.env.WEB_URL}/app/settings/billing?status=success`,
      cancelUrl: `${this.env.WEB_URL}/app/settings/billing?status=cancelled`,
    });
    await this.audit.log({ action: 'billing.checkout_started', actorId: userId, metadata: { plan, interval, provider: this.provider.name } });
    return { url };
  }

  async portal(userId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { userId, providerCustomerId: { not: null } }, orderBy: { updatedAt: 'desc' } });
    if (!sub?.providerCustomerId) {
      if (this.provider.name === 'dev') return this.provider.createPortal({ customerId: 'dev', returnUrl: '' });
      throw Errors.badRequest('No billing account yet');
    }
    return this.provider.createPortal({ customerId: sub.providerCustomerId, returnUrl: `${this.env.WEB_URL}/app/settings/billing` });
  }

  async applySubscription(s: NormalizedSubscription, provider: string) {
    if (!s.userId) throw new Error('Subscription has no user reference');
    await this.prisma.subscription.upsert({
      where: { providerSubscriptionId: s.providerSubscriptionId },
      create: { userId: s.userId, plan: s.plan, status: s.status, provider, providerCustomerId: s.providerCustomerId, providerSubscriptionId: s.providerSubscriptionId, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd },
      update: { plan: s.plan, status: s.status, providerCustomerId: s.providerCustomerId, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd },
    });
    this.entitlements.invalidate(s.userId);
    this.realtime.toUser(s.userId, 'entitlements.changed', {});
    await this.audit.log({ action: 'billing.subscription_updated', actorId: s.userId, metadata: { plan: s.plan, status: s.status, provider } });
  }

  async webhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    let event;
    try {
      event = await this.provider.parseWebhook(rawBody, headers);
    } catch (e) {
      this.logger.warn(`rejected webhook: ${(e as Error).message}`);
      throw Errors.badRequest('Invalid webhook', 'invalid_webhook');
    }
    const seen = await this.prisma.billingEvent.findUnique({ where: { id: event.id } });
    if (seen) return { ok: true, duplicate: true };
    if (event.subscription) await this.applySubscription(event.subscription, this.provider.name);
    await this.prisma.billingEvent.create({ data: { id: event.id, provider: this.provider.name, type: event.type } });
    return { ok: true };
  }

  /** DEV_TOOLS only: activate/cancel a plan without a payment provider. */
  async devActivate(userId: string, plan: PlanKey, interval: Interval) {
    if (!this.env.DEV_TOOLS || this.provider.name !== 'dev') throw Errors.notFound('Endpoint');
    if (plan === 'FREE') {
      await this.prisma.subscription.updateMany({ where: { userId, provider: 'dev' }, data: { status: 'CANCELED', currentPeriodEnd: new Date() } });
      this.entitlements.invalidate(userId);
      this.realtime.toUser(userId, 'entitlements.changed', {});
      return this.entitlementsFor(userId);
    }
    const end = new Date(Date.now() + (interval === 'year' ? 365 : 30) * 86_400_000);
    await this.applySubscription(
      { userId, plan, status: 'ACTIVE', providerCustomerId: `dev_${userId}`, providerSubscriptionId: `dev_${userId}`, currentPeriodEnd: end, cancelAtPeriodEnd: false },
      'dev',
    );
    return this.entitlementsFor(userId);
  }

  /** Defaults used by the admin UI to reset rows. */
  defaults() {
    return PLAN_DEFAULTS;
  }
}
