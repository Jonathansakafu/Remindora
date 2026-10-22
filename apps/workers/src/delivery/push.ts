import type { ServerEnv } from '@remindora/config';
import { createSign } from 'node:crypto';
import type pino from 'pino';
import webpush from 'web-push';

/** Push transports. Each returns a provider message id, or throws PushError (gone=true → token is dead). */

export class PushError extends Error {
  constructor(
    message: string,
    readonly gone = false,
  ) {
    super(message);
  }
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Android channel id (priority-mapped). */
  channelId: string;
  /** Replaces an earlier notification for the same reminder on the device. */
  tag: string;
  categoryId?: string;
  sound: boolean;
}

export interface PushProviders {
  fcm: ((token: string, msg: PushMessage | { dataOnly: Record<string, string> }) => Promise<string>) | null;
  expo: (token: string, msg: PushMessage | { dataOnly: Record<string, string> }) => Promise<string>;
  webPush: ((subscriptionJson: string, payload: Record<string, unknown>, topic: string) => Promise<string>) | null;
}

/** FCM HTTP v1 with an OAuth token minted from the service account (RS256 JWT bearer grant). */
function fcmProvider(env: ServerEnv, log: pino.Logger): PushProviders['fcm'] {
  if (!env.FCM_PROJECT_ID || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY) return null;
  const privateKey = env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n');
  let cached: { token: string; exp: number } | null = null;

  async function accessToken() {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: env.FCM_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    if (!res.ok) throw new PushError(`FCM auth failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
    return cached.token;
  }

  return async (token, msg) => {
    const message =
      'dataOnly' in msg
        ? { token, data: msg.dataOnly, android: { priority: 'HIGH' } }
        : {
            token,
            data: msg.data,
            android: {
              priority: 'HIGH',
              collapse_key: msg.tag,
              notification: { title: msg.title, body: msg.body, channel_id: msg.channelId, tag: msg.tag, ...(msg.sound ? { default_sound: true } : {}) },
            },
          };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { status?: string; message?: string } };
    if (!res.ok) {
      const gone = body.error?.status === 'NOT_FOUND' || body.error?.status === 'UNREGISTERED';
      log.warn({ status: res.status, err: body.error?.status }, 'fcm send failed');
      throw new PushError(body.error?.message ?? `FCM ${res.status}`, gone);
    }
    return body.name ?? '';
  };
}

/** Expo push service: works with Expo dev builds and EAS builds without server-side FCM credentials. */
function expoProvider(): PushProviders['expo'] {
  return async (token, msg) => {
    const payload =
      'dataOnly' in msg
        ? { to: token, data: msg.dataOnly, priority: 'high', _contentAvailable: true }
        : { to: token, title: msg.title, body: msg.body, data: msg.data, channelId: msg.channelId, categoryId: msg.categoryId, priority: 'high', sound: msg.sound ? 'default' : null, tag: msg.tag };
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } } };
    if (!res.ok || body.data?.status === 'error') {
      throw new PushError(body.data?.message ?? `Expo ${res.status}`, body.data?.details?.error === 'DeviceNotRegistered');
    }
    return body.data?.id ?? '';
  };
}

function webPushProvider(env: ServerEnv): PushProviders['webPush'] {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return async (subscriptionJson, payload, topic) => {
    try {
      const res = await webpush.sendNotification(JSON.parse(subscriptionJson), JSON.stringify(payload), { TTL: 3600, urgency: 'high', topic: topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
      return res.headers?.location ?? '';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      throw new PushError(`Web push ${status ?? 'error'}`, status === 404 || status === 410);
    }
  };
}

export function createPushProviders(env: ServerEnv, log: pino.Logger): PushProviders {
  return { fcm: fcmProvider(env, log), expo: expoProvider(), webPush: webPushProvider(env) };
}
