'use client';
import type { AuthTokensDTO } from '@remindora/types';
import { api } from './api';
import { isTauri } from './platform';
import { useSession } from './session';
import { useUi } from './ui-store';

/**
 * Desktop-shell integration (no-ops in the browser): global Quick Add shortcut,
 * tray actions and `remindora://` deep links (OAuth callback, task links).
 */
export async function initDesktop(navigate: (href: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');

  const handleUrl = async (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    const path = `${url.host}${url.pathname}`.replace(/\/$/, '');
    if (path === 'auth/callback') {
      const code = url.searchParams.get('code');
      if (!code) return;
      const tokens = await api<AuthTokensDTO>('/auth/oauth/exchange', { body: { code }, auth: false });
      await useSession.getState().accept(tokens);
      navigate('/app/today');
    } else if (path === 'task') {
      const id = url.searchParams.get('id');
      if (id) useUi.getState().selectTask(id);
    }
  };

  const unlisteners = await Promise.all([
    listen('remindora://quick-add', () => useUi.getState().setQuickAdd(true)),
    listen<string>('remindora://deep-link', (e) => void handleUrl(e.payload)),
    onOpenUrl((urls) => urls.forEach((u) => void handleUrl(u))),
  ]);
  return () => unlisteners.forEach((u) => u());
}

export async function checkForUpdates(): Promise<'none' | 'installed' | 'unsupported'> {
  if (!isTauri()) return 'unsupported';
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return 'none';
  await update.downloadAndInstall();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
  return 'installed';
}
