'use client';
import type { DeviceInfoInput } from '@remindora/types';
import { APP_VERSION } from './config';

/**
 * Platform adapter. The same UI runs in the browser and inside the Tauri desktop
 * shell; desktop uses the OS keychain for the refresh token and native notifications.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** OS keychain on desktop (macOS Keychain / Windows Credential Manager / Secret Service). */
export const secureStore = {
  async get(key: string): Promise<string | null> {
    if (!isTauri()) return null;
    return invoke<string | null>('secure_get', { key });
  },
  async set(key: string, value: string): Promise<void> {
    if (isTauri()) await invoke('secure_set', { key, value });
  },
  async remove(key: string): Promise<void> {
    if (isTauri()) await invoke('secure_delete', { key });
  },
};

export function deviceInfo(): DeviceInfoInput {
  if (typeof navigator === 'undefined') return { name: 'Web browser', platform: 'WEB' };
  const ua = navigator.userAgent;
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown';
  if (isTauri()) {
    const platform = os === 'macOS' ? 'DESKTOP_MACOS' : os === 'Windows' ? 'DESKTOP_WINDOWS' : 'DESKTOP_LINUX';
    return { name: `Remindora for ${os}`, platform, osVersion: os, appVersion: APP_VERSION };
  }
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return { name: `${browser} on ${os}`, platform: 'WEB', osVersion: os, appVersion: APP_VERSION };
}

const openNotifications = new Map<string, Notification>();

/** Raises an OS-level notification (Tauri native, or the browser Notification API). */
export async function nativeNotify(opts: { title: string; body: string; tag: string; urgent?: boolean; onClick?: () => void }) {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (granted) n.sendNotification({ title: opts.title, body: opts.body });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const notification = new Notification(opts.title, { body: opts.body, tag: opts.tag, requireInteraction: opts.urgent, icon: '/icon.svg' });
  notification.onclick = () => {
    window.focus();
    opts.onClick?.();
    notification.close();
  };
  openNotifications.set(opts.tag, notification);
}

/** Closes an OS notification that was resolved on another device. */
export function dismissNative(tag: string) {
  openNotifications.get(tag)?.close();
  openNotifications.delete(tag);
}
