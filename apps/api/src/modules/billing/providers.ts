import { createHmac } from 'node:crypto';
import { safeEqual } from '@remindora/auth';
import type { PlanKey } from '@remindora/types';
import { Errors } from '../../common/errors';
import type { ServerEnv } from '../../config';

export type Interval = 'month' | 'year';

export interface NormalizedSubscription {
  userId: string | null;
  plan: PlanKey;
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  providerCustomerId: string | null;
  providerSubscriptionId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface NormalizedEvent {
  id: string;
  type: string;
  subscription: NormalizedSubscription | null;
}

/** Billing provider port. Swap Stripe for Paddle, Lemon Squeezy, Play Billing… without touching entitlements. */
export interface BillingProvider {
  readonly name: string;
  createCheckout(input: { userId: string; email: string; plan: PlanKey; interval: Interval; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<NormalizedEvent>;
}

/** Local development: "checkout" returns to the app, which activates the plan via /billing/dev/activate. */
export class DevBillingProvider implements BillingProvider {
  readonly name = 'dev';
  constructor(private readonly env: ServerEnv) {}

  async createCheckout(input: { plan: PlanKey; interval: Interval }) {
    return { url: `${this.env.WEB_URL}/app/settings/billing?devCheckout=${input.plan}&interval=${input.interval}` };
  }

  async createPortal() {
    return { url: `${this.env.WEB_URL}/app/settings/billing` };
  }

  async parseWebhook(): Promise<NormalizedEvent> {
    throw new Error('The dev billing provider has no webhooks');
  }
}

/** No payment provider configured: everything stays on the Free plan. */
export class DisabledBillingProvider implements BillingProvider {
  readonly name = 'none';

  async createCheckout(): Promise<{ url: string }> {
    throw Errors.notConfigured('Payments');
  }

  async createPortal(): Promise<{ url: string }> {
    throw Errors.notConfigured('Payments');
  }

  async parseWebhook(): Promise<NormalizedEvent> {
    throw Errors.notConfigured('Payments');
  }
}

const STRIPE_STATUS: Record<string, NormalizedSubscription['status']> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'PAST_DUE',
  incomplete_expired: 'EXPIRED',
  paused: 'PAST_DUE',
};

/** Stripe via its REST API (no SDK), with webhook signature verification and replay tolerance. */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe';
  constructor(private readonly env: ServerEnv) {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for BILLING_PROVIDER=stripe');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${path}${method === 'GET' && params ? `?${new URLSearchParams(params)}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' && params ? new URLSearchParams(params) : undefined,
    });
    const body = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe ${path}: ${body.error?.message ?? res.status}`);
    return body;
  }

  private priceFor(plan: PlanKey, interval: Interval): string {
    const price = plan === 'TEAM' ? this.env.STRIPE_PRICE_TEAM_MONTHLY : interval === 'year' ? this.env.STRIPE_PRICE_PREMIUM_YEARLY : this.env.STRIPE_PRICE_PREMIUM_MONTHLY;
    if (!price) throw new Error(`No Stripe price configured for ${plan}/${interval}`);
    return price;
  }

  private planForPrice(priceId: string | undefined, fallback?: string): PlanKey {
    if (priceId && priceId === this.env.STRIPE_PRICE_TEAM_MONTHLY) return 'TEAM';
    if (priceId && (priceId === this.env.STRIPE_PRICE_PREMIUM_MONTHLY || priceId === this.env.STRIPE_PRICE_PREMIUM_YEARLY)) return 'PREMIUM';
    return fallback === 'TEAM' ? 'TEAM' : 'PREMIUM';
  }

  async createCheckout(input: { userId: string; email: string; plan: PlanKey; interval: Interval; successUrl: string; cancelUrl: string }) {
    const session = await this.call<{ url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': this.priceFor(input.plan, input.interval),
      'line_items[0][quantity]': '1',
      client_reference_id: input.userId,
      customer_email: input.email,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'subscription_data[metadata][userId]': input.userId,
      'subscription_data[metadata][plan]': input.plan,
      allow_promotion_codes: 'true',
    });
    return { url: session.url };
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    return this.call<{ url: string }>('POST', '/billing_portal/sessions', { customer: input.customerId, return_url: input.returnUrl });
  }

  verifySignature(rawBody: Buffer, header: string | undefined, toleranceSeconds = 300) {
    if (!header) throw new Error('Missing Stripe-Signature');
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) throw new Error('Stale webhook');
    const expected = createHmac('sha256', this.env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const candidates = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!candidates.some((c) => safeEqual(c, expected))) throw new Error('Bad webhook signature');
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<NormalizedEvent> {
    this.verifySignature(rawBody, headers['stripe-signature'] as string | undefined);
    const event = JSON.parse(rawBody.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
    let subId: string | null = null;
    if (event.type === 'checkout.session.completed') subId = (event.data.object.subscription as string) ?? null;
    if (event.type.startsWith('customer.subscription.')) subId = event.data.object.id as string;
    if (!subId) return { id: event.id, type: event.type, subscription: null };

    // Always re-fetch: webhook payloads can arrive out of order.
    const sub = await this.call<{
      id: string;
      status: string;
      customer: string;
      cancel_at_period_end: boolean;
      current_period_end?: number;
      items: { data: Array<{ price: { id: string }; current_period_end?: number }> };
      metadata: Record<string, string>;
    }>('GET', `/subscriptions/${subId}`);
    const periodEnd = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
    return {
      id: event.id,
      type: event.type,
      subscription: {
        userId: sub.metadata.userId ?? ((event.data.object.client_reference_id as string) || null),
        plan: this.planForPrice(sub.items.data[0]?.price.id, sub.metadata.plan),
        status: STRIPE_STATUS[sub.status] ?? 'EXPIRED',
        providerCustomerId: sub.customer,
        providerSubscriptionId: sub.id,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
    };
  }
}
