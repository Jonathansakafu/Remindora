'use client';
import { api } from './api';
import { VAPID_PUBLIC_KEY } from './config';
import { isTauri } from './platform';

export type Permission = 'granted' | 'denied' | 'default' | 'unsupported';

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Current OS/browser permission for notifications on this device. */
export async function notificationPermission(): Promise<Permission> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    return (await n.isPermissionGranted()) ? 'granted' : 'default';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Browser push: (re)subscribes this browser and tells the server. Safe to call on
 * every launch — a new sign-in is a new device, so the subscription must be re-linked.
 */
export async function syncWebPush(): Promise<boolean> {
  if (isTauri() || !VAPID_PUBLIC_KEY || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) }));
  await api('/devices/current/push', { body: { provider: 'webpush', token: JSON.stringify(sub) } });
  return true;
}

/** Asks for permission (must run from a click in browsers) and wires up delivery. */
export async function enableDeviceNotifications(): Promise<Permission> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return 'granted';
    return (await n.requestPermission()) === 'granted' ? 'granted' : 'denied';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') await syncWebPush();
  return result;
}
