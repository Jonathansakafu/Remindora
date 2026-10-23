'use client';
import { useEffect, useState } from 'react';

/** Installers live on the GitHub release; the release API tells us the newest version. */
export const RELEASES_URL = 'https://github.com/Jonathansakafu/Remindora/releases/latest';
const LATEST_API = 'https://api.github.com/repos/Jonathansakafu/Remindora/releases/latest';

export type DownloadPlatform = 'android' | 'windows' | 'macos-arm' | 'macos-intel' | 'linux';

export interface Download {
  platform: DownloadPlatform;
  label: string;
  detail: string;
  url: string;
  size: number | null;
}

export interface LatestRelease {
  version: string;
  publishedAt: string | null;
  downloads: Download[];
}

const PLATFORMS: Array<{ platform: DownloadPlatform; label: string; detail: string; match: RegExp }> = [
  { platform: 'android', label: 'Android', detail: 'APK · Android 8+', match: /\.apk$/i },
  { platform: 'windows', label: 'Windows', detail: 'Installer · Windows 10/11', match: /x64-setup\.exe$|x64_en-US\.msi$/i },
  { platform: 'macos-arm', label: 'macOS (Apple Silicon)', detail: 'DMG · M1 and newer', match: /aarch64\.dmg$/i },
  { platform: 'macos-intel', label: 'macOS (Intel)', detail: 'DMG · Intel Macs', match: /x64\.dmg$/i },
  { platform: 'linux', label: 'Linux', detail: 'AppImage · x86_64', match: /\.AppImage$/i },
];

/** Used when GitHub can't be reached: every platform still gets a working link. */
export const FALLBACK: LatestRelease = {
  version: '',
  publishedAt: null,
  downloads: [
    { platform: 'android', label: 'Android', detail: 'APK · Android 8+', url: `${RELEASES_URL}/download/Remindora.apk`, size: null },
    ...PLATFORMS.slice(1).map((p) => ({ platform: p.platform, label: p.label, detail: p.detail, url: RELEASES_URL, size: null })),
  ],
};

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease> {
  const res = await fetch(LATEST_API, { signal, headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const body = (await res.json()) as { tag_name: string; published_at: string | null; assets: Array<{ name: string; browser_download_url: string; size: number }> };
  const downloads: Download[] = [];
  for (const p of PLATFORMS) {
    const asset = body.assets.find((a) => p.match.test(a.name));
    downloads.push(asset ? { platform: p.platform, label: p.label, detail: p.detail, url: asset.browser_download_url, size: asset.size } : { platform: p.platform, label: p.label, detail: 'Coming soon', url: RELEASES_URL, size: null });
  }
  return { version: body.tag_name.replace(/^v/, ''), publishedAt: body.published_at, downloads };
}

export function useLatestRelease() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    fetchLatestRelease(ctl.signal)
      .then(setRelease)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setFailed(true);
      });
    return () => ctl.abort();
  }, []);
  return { release: release ?? (failed ? FALLBACK : null), loading: !release && !failed };
}

/** Best guess at the visitor's platform, for highlighting the right download. */
export function detectPlatform(): DownloadPlatform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X/i.test(ua)) return 'macos-arm';
  if (/Linux/i.test(ua)) return 'linux';
  return null;
}

export function formatSize(bytes: number | null) {
  return bytes ? `${(bytes / 1_048_576).toFixed(bytes > 100 * 1_048_576 ? 0 : 1)} MB` : '';
}
