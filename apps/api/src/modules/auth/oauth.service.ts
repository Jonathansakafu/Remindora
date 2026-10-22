import { Inject, Injectable } from '@nestjs/common';
import { encryptSecret, randomToken, sha256 } from '@remindora/auth';
import type { AuthTokensDTO, DeviceInfoInput } from '@remindora/types';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ENV, KEYS, type Keys, type ServerEnv } from '../../config';
import { AuthService, type RequestMeta } from './auth.service';

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
  profile: (accessToken: string) => Promise<{ id: string; email: string; name: string | null; avatarUrl: string | null }>;
}

interface OAuthState {
  provider: string;
  verifier: string;
  device: DeviceInfoInput;
  native: boolean;
}

/** Authorization-code + PKCE OAuth sign-in. Only verified provider emails are accepted. */
@Injectable()
export class OAuthService {
  private readonly providers: Record<string, ProviderConfig>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(KEYS) private readonly keys: Keys,
  ) {
    this.providers = {
      google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scope: 'openid email profile',
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        profile: async (token) => {
          const p = await getJson<{ sub: string; email: string; email_verified: boolean; name?: string; picture?: string }>('https://openidconnect.googleapis.com/v1/userinfo', token);
          if (!p.email_verified) throw Errors.badRequest('Your Google email is not verified', 'email_unverified');
          return { id: p.sub, email: p.email.toLowerCase(), name: p.name ?? null, avatarUrl: p.picture ?? null };
        },
      },
      github: {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scope: 'read:user user:email',
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        profile: async (token) => {
          const u = await getJson<{ id: number; name: string | null; avatar_url: string }>('https://api.github.com/user', token);
          const emails = await getJson<Array<{ email: string; primary: boolean; verified: boolean }>>('https://api.github.com/user/emails', token);
          const primary = emails.find((e) => e.primary && e.verified);
          if (!primary) throw Errors.badRequest('Your GitHub account has no verified primary email', 'email_unverified');
          return { id: String(u.id), email: primary.email.toLowerCase(), name: u.name, avatarUrl: u.avatar_url };
        },
      },
      microsoft: {
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        scope: 'openid email profile User.Read',
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
        profile: async (token) => {
          const p = await getJson<{ id: string; mail: string | null; userPrincipalName: string; displayName: string | null }>('https://graph.microsoft.com/v1.0/me', token);
          return { id: p.id, email: (p.mail ?? p.userPrincipalName).toLowerCase(), name: p.displayName, avatarUrl: null };
        },
      },
    };
  }

  enabledProviders(): string[] {
    return Object.entries(this.providers)
      .filter(([, p]) => p.clientId && p.clientSecret)
      .map(([name]) => name);
  }

  private config(provider: string): ProviderConfig {
    const cfg = this.providers[provider];
    if (!cfg) throw Errors.notFound('OAuth provider');
    if (!cfg.clientId || !cfg.clientSecret) throw Errors.notConfigured(`${provider} sign-in`);
    return cfg;
  }

  private callbackUrl(provider: string) {
    return `${this.env.API_PUBLIC_URL}/auth/oauth/${provider}/callback`;
  }

  async start(provider: string, device: DeviceInfoInput, native: boolean): Promise<string> {
    const cfg = this.config(provider);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.redis.client.set(`oauth:state:${state}`, JSON.stringify({ provider, verifier, device, native } satisfies OAuthState), 'EX', 600);
    const url = new URL(cfg.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: cfg.clientId!,
      redirect_uri: this.callbackUrl(provider),
      response_type: 'code',
      scope: cfg.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Handles the provider callback. Returns tokens and whether the client is native. */
  async callback(provider: string, code: string, state: string, meta: RequestMeta): Promise<{ tokens: AuthTokensDTO; native: boolean }> {
    const cfg = this.config(provider);
    const raw = await this.redis.client.getdel(`oauth:state:${state}`);
    if (!raw) throw Errors.badRequest('Sign-in session expired, please try again', 'oauth_state');
    const st = JSON.parse(raw) as OAuthState;
    if (st.provider !== provider) throw Errors.badRequest('Provider mismatch', 'oauth_state');

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.callbackUrl(provider),
        client_id: cfg.clientId!,
        client_secret: cfg.clientSecret!,
        code_verifier: st.verifier,
      }),
    });
    if (!tokenRes.ok) throw Errors.badRequest('Could not complete sign-in with the provider', 'oauth_exchange');
    const tok = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    const profile = await cfg.profile(tok.access_token);

    let user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) user = await this.auth.createUser(profile.email);
    if (!user.name || !user.avatarUrl) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { name: user.name ?? profile.name, avatarUrl: user.avatarUrl ?? profile.avatarUrl } });
    }
    const account = await this.prisma.account.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.id } },
      create: { userId: user.id, provider, providerAccountId: profile.id, scope: tok.scope ?? cfg.scope },
      update: { scope: tok.scope ?? cfg.scope },
    });
    if (account.userId !== user.id) throw Errors.conflict('This provider account is linked to a different user');
    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encryptSecret(this.keys.encryption, tok.access_token, `account:${account.id}`),
        refreshTokenEnc: tok.refresh_token ? encryptSecret(this.keys.encryption, tok.refresh_token, `account:${account.id}`) : undefined,
        expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
      },
    });
    await this.audit.log({ action: 'auth.oauth', actorId: user.id, ip: meta.ip, metadata: { provider } });
    const tokens = await this.auth.issueSession(user, st.device, 'OAUTH', meta);
    return { tokens, native: st.native };
  }

  /** Native apps receive a one-time code via deep link and swap it here, so tokens never travel in URLs. */
  async createExchangeCode(tokens: AuthTokensDTO): Promise<string> {
    const code = randomToken(24);
    await this.redis.client.set(`oauth:exchange:${sha256(code)}`, JSON.stringify(tokens), 'EX', 60);
    return code;
  }

  async exchange(code: string): Promise<AuthTokensDTO> {
    const raw = await this.redis.client.getdel(`oauth:exchange:${sha256(code)}`);
    if (!raw) throw Errors.gone('This sign-in link expired', 'exchange_expired');
    return JSON.parse(raw) as AuthTokensDTO;
  }
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'Remindora' } });
  if (!res.ok) throw Errors.badRequest('Could not read your profile from the provider', 'oauth_profile');
  return (await res.json()) as T;
}
