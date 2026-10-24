export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
/** Hosted web build proxies /auth/* through its own origin so the refresh cookie stays first-party. */
export const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_SAME_ORIGIN === '1' ? '' : API_URL;
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
export const APP_VERSION = '0.2.4';
