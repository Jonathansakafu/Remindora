import { z } from 'zod';

/**
 * Server-side environment, validated once at boot. A missing or malformed
 * required secret fails fast with a readable message instead of at first use.
 */

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const key32 = z
  .string()
  .min(32, 'must be a 32-byte key encoded as base64 or hex (generate with `openssl rand -base64 32`)');

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  WEB_URL: z.url().default('http://localhost:3000'),
  /** Comma-separated. Tauri uses tauri://localhost (macOS/Linux) and http://tauri.localhost (Windows). */
  CORS_ORIGINS: z.string().default('http://localhost:3000,tauri://localhost,http://tauri.localhost'),
  APP_DEEP_LINK_SCHEME: z.string().default('remindora'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: key32,
  ENCRYPTION_KEY: key32,
  PAIRING_KEY: key32,
  OTP_PEPPER: key32,
  /** Set to true behind HTTPS so auth cookies get the Secure flag. */
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('Remindora <no-reply@remindora.app>'),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),

  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  /** PEM private key; literal "\n" sequences are converted to newlines. */
  FCM_PRIVATE_KEY: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@remindora.app'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('remindora-attachments'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().default(25 * 1024 * 1024),

  BILLING_PROVIDER: z.enum(['dev', 'stripe']).default('dev'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PREMIUM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_YEARLY: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),

  AI_PROVIDER: z.enum(['heuristic', 'anthropic']).default('heuristic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),

  SENTRY_DSN: z.string().optional(),
  /** Exposes /billing/dev/activate and console email codes. Never enable in production. */
  DEV_TOOLS: bool,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && source === process.env) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.DEV_TOOLS) throw new Error('DEV_TOOLS must not be enabled in production');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (env.BILLING_PROVIDER === 'dev') throw new Error('BILLING_PROVIDER=dev is not allowed in production');
  }
  if (source === process.env) cached = env;
  return env;
}

export function corsOrigins(env: ServerEnv): string[] {
  return env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}
