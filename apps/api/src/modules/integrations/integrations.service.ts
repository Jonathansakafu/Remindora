import { Inject, Injectable } from '@nestjs/common';
import { encryptSecret, randomToken } from '@remindora/auth';
import { refreshIcsSubscription, type Prisma } from '@remindora/database';
import { assertPublicUrl, safeFetch, UnsafeUrlError } from '@remindora/notifications';
import { AuditService } from '../../common/audit.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ENV, KEYS, type Keys, type ServerEnv } from '../../config';

/**
 * Integration registry. Each provider is an adapter with a connect flow;
 * background sync runs in the workers (calendar import, webhook delivery,
 * Slack/Notion export). Providers without server credentials report
 * `configured: false` and their connect endpoint returns 501.
 */
export const PROVIDERS = {
  ics: { name: 'Calendar subscription (ICS)', kind: 'url', description: 'Show any iCal/ICS feed alongside your tasks.' },
  google_calendar: { name: 'Google Calendar', kind: 'oauth', description: 'Import events from your primary Google calendar.' },
  outlook_calendar: { name: 'Outlook Calendar', kind: 'oauth', description: 'Import events from your Microsoft 365 / Outlook calendar.' },
  notion: { name: 'Notion', kind: 'oauth', description: 'Create a Notion page for new tasks in a database you choose.' },
  slack: { name: 'Slack', kind: 'webhook', description: 'Post critical alerts and your morning digest to a Slack channel.' },
  zapier: { name: 'Zapier & webhooks', kind: 'webhook', description: 'Signed webhooks for task.created / task.updated / task.completed.' },
} as const;
export type ProviderKey = keyof typeof PROVIDERS;

const OAUTH: Record<'google_calendar' | 'outlook_calendar' | 'notion', { authorize: string; token: string; scope: string; id: keyof ServerEnv; secret: keyof ServerEnv }> = {
  google_calendar: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/calendar.readonly', id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  outlook_calendar: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'offline_access Calendars.Read', id: 'MICROSOFT_CLIENT_ID', secret: 'MICROSOFT_CLIENT_SECRET' },
  notion: { authorize: 'https://api.notion.com/v1/oauth/authorize', token: 'https://api.notion.com/v1/oauth/token', scope: '', id: 'NOTION_CLIENT_ID', secret: 'NOTION_CLIENT_SECRET' },
};

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(KEYS) private readonly keys: Keys,
  ) {}

  private allowPrivate() {
    return this.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_FETCH === 'true';
  }

  private configured(key: ProviderKey): boolean {
    if (key === 'ics' || key === 'slack' || key === 'zapier') return true;
    const o = OAUTH[key];
    return Boolean(this.env[o.id] && this.env[o.secret]);
  }

  async list(userId: string) {
    const rows = await this.prisma.integration.findMany({ where: { userId } });
    const subs = await this.prisma.calendarSubscription.count({ where: { userId } });
    return Object.entries(PROVIDERS).map(([key, p]) => {
      const row = rows.find((r) => r.provider === key);
      return {
        key,
        ...p,
        configured: this.configured(key as ProviderKey),
        status: key === 'ics' ? (subs ? 'connected' : 'disconnected') : (row?.status ?? 'disconnected'),
        lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        config: row ? this.publicConfig(row.config as Record<string, unknown>) : null,
      };
    });
  }

  private publicConfig(c: Record<string, unknown>) {
    const { secret: _s, ...rest } = c;
    return rest;
  }

  /** OAuth providers: returns the authorize URL. Webhook providers: stores the destination. */
  async connect(userId: string, provider: ProviderKey, body: { url?: string; databaseId?: string }) {
    await this.entitlements.assertFeature(userId, 'integrations');
    if (!this.configured(provider)) throw Errors.notConfigured(PROVIDERS[provider].name);

    if (provider === 'slack' || provider === 'zapier') {
      if (!body.url) throw Errors.badRequest('A webhook URL is required');
      try {
        await assertPublicUrl(body.url, this.allowPrivate());
      } catch (e) {
        throw Errors.badRequest((e as Error).message, 'unsafe_url');
      }
      if (provider === 'slack' && !/^https:\/\/hooks\.slack\.com\//.test(body.url)) throw Errors.badRequest('Use a Slack incoming-webhook URL (https://hooks.slack.com/…)');
      const secret = randomToken(24);
      const config = { url: body.url, events: provider === 'zapier' ? ['task.created', 'task.updated', 'task.completed'] : ['critical', 'digest'] };
      await this.prisma.integration.upsert({
        where: { userId_provider: { userId, provider } },
        create: { userId, provider, status: 'connected', config, credentialsEnc: encryptSecret(this.keys.encryption, secret, `integration:${userId}:${provider}`) },
        update: { status: 'connected', config, credentialsEnc: encryptSecret(this.keys.encryption, secret, `integration:${userId}:${provider}`), lastError: null },
      });
      await this.audit.log({ action: 'integration.connected', actorId: userId, metadata: { provider } });
      // The signing secret is shown once so the receiver can verify X-Remindora-Signature.
      return { status: 'connected', signingSecret: provider === 'zapier' ? secret : undefined };
    }
    if (provider === 'ics') throw Errors.badRequest('Add calendar subscriptions under Calendar → Subscriptions');

    const o = OAUTH[provider];
    const state = randomToken(24);
    await this.redis.client.set(`integration:state:${state}`, JSON.stringify({ userId, provider, databaseId: body.databaseId ?? null }), 'EX', 600);
    const url = new URL(o.authorize);
    const params: Record<string, string> = { client_id: String(this.env[o.id]), redirect_uri: `${this.env.API_PUBLIC_URL}/integrations/${provider}/callback`, response_type: 'code', state };
    if (o.scope) params.scope = o.scope;
    if (provider === 'google_calendar') Object.assign(params, { access_type: 'offline', prompt: 'consent' });
    if (provider === 'notion') params.owner = 'user';
    url.search = new URLSearchParams(params).toString();
    return { authorizeUrl: url.toString() };
  }

  async callback(provider: ProviderKey, code: string, state: string) {
    if (!(provider in OAUTH)) throw Errors.notFound('Integration');
    const raw = await this.redis.client.getdel(`integration:state:${state}`);
    if (!raw) throw Errors.badRequest('This connection attempt expired', 'oauth_state');
    const st = JSON.parse(raw) as { userId: string; provider: string; databaseId: string | null };
    if (st.provider !== provider) throw Errors.badRequest('Provider mismatch', 'oauth_state');
    const o = OAUTH[provider as keyof typeof OAUTH];
    const redirect = `${this.env.API_PUBLIC_URL}/integrations/${provider}/callback`;
    const res =
      provider === 'notion'
        ? await fetch(o.token, {
            method: 'POST',
            headers: { Authorization: `Basic ${Buffer.from(`${this.env[o.id]}:${this.env[o.secret]}`).toString('base64')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirect }),
          })
        : await fetch(o.token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: String(this.env[o.id]), client_secret: String(this.env[o.secret]) }),
          });
    if (!res.ok) throw Errors.badRequest('The provider rejected the connection', 'oauth_exchange');
    const tokens = (await res.json()) as Record<string, unknown>;
    const credentials = { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null, expires_at: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null };
    await this.prisma.integration.upsert({
      where: { userId_provider: { userId: st.userId, provider } },
      create: { userId: st.userId, provider, status: 'connected', config: { databaseId: st.databaseId }, credentialsEnc: encryptSecret(this.keys.encryption, JSON.stringify(credentials), `integration:${st.userId}:${provider}`) },
      update: { status: 'connected', lastError: null, config: { databaseId: st.databaseId }, credentialsEnc: encryptSecret(this.keys.encryption, JSON.stringify(credentials), `integration:${st.userId}:${provider}`) },
    });
    await this.audit.log({ action: 'integration.connected', actorId: st.userId, metadata: { provider } });
    return { userId: st.userId };
  }

  async updateConfig(userId: string, provider: ProviderKey, config: Record<string, unknown>) {
    const row = await this.prisma.integration.findUnique({ where: { userId_provider: { userId, provider } } });
    if (!row) throw Errors.notFound('Integration');
    await this.prisma.integration.update({ where: { id: row.id }, data: { config: { ...(row.config as object), ...config } as Prisma.InputJsonValue } });
    return { ok: true };
  }

  async disconnect(userId: string, provider: ProviderKey) {
    await this.prisma.integration.deleteMany({ where: { userId, provider } });
    await this.audit.log({ action: 'integration.disconnected', actorId: userId, metadata: { provider } });
    return { ok: true };
  }

  // ── ICS calendar subscriptions ──

  async subscriptions(userId: string) {
    const rows = await this.prisma.calendarSubscription.findMany({ where: { userId }, include: { _count: { select: { events: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((s) => ({ id: s.id, name: s.name, color: s.color, url: s.url.replace(/([?&](token|key|auth)=)[^&]+/gi, '$1…'), lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null, lastError: s.lastError, events: s._count.events }));
  }

  async subscribe(userId: string, input: { name: string; url: string; color?: string }) {
    await this.entitlements.assertFeature(userId, 'integrations');
    try {
      await assertPublicUrl(input.url, this.allowPrivate());
    } catch (e) {
      throw Errors.badRequest(e instanceof UnsafeUrlError ? e.message : 'Invalid URL', 'unsafe_url');
    }
    const count = await this.prisma.calendarSubscription.count({ where: { userId } });
    if (count >= 20) throw Errors.badRequest('You can subscribe to up to 20 calendars');
    const sub = await this.prisma.calendarSubscription.create({ data: { userId, name: input.name, url: input.url.replace(/^webcals?:\/\//i, 'https://'), color: input.color ?? '#7865FF' } });
    const result = await this.refresh(userId, sub.id);
    return { id: sub.id, ...result };
  }

  async refresh(userId: string, id: string) {
    const sub = await this.prisma.calendarSubscription.findFirst({ where: { id, userId } });
    if (!sub) throw Errors.notFound('Subscription');
    return refreshIcsSubscription(this.prisma, id, (url) => safeFetch(url, { allowPrivate: this.allowPrivate(), headers: { Accept: 'text/calendar' } }));
  }

  async unsubscribe(userId: string, id: string) {
    const res = await this.prisma.calendarSubscription.deleteMany({ where: { id, userId } });
    if (!res.count) throw Errors.notFound('Subscription');
    return { ok: true };
  }
}
