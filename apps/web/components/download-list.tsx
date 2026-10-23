'use client';
import { cn, Spinner } from '@remindora/ui';
import { Apple, Download, Monitor, Smartphone, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { detectPlatform, formatSize, RELEASES_URL, useLatestRelease, type DownloadPlatform } from '@/lib/downloads';

const ICONS: Record<DownloadPlatform, typeof Download> = { android: Smartphone, ios: Smartphone, windows: Monitor, 'macos-arm': Apple, 'macos-intel': Apple, linux: Terminal };

/** Latest installers from the GitHub release, with the visitor's platform first. */
export function DownloadList({ currentVersion, compact }: { currentVersion?: string; compact?: boolean }) {
  const { release, loading } = useLatestRelease();
  const [mine, setMine] = useState<DownloadPlatform | null>(null);
  useEffect(() => setMine(detectPlatform()), []);

  if (loading || !release) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-faint">
        <Spinner size={14} /> Checking for the latest version…
      </div>
    );
  }

  const sorted = [...release.downloads].sort((a, b) => Number(b.platform === mine) - Number(a.platform === mine));
  const outdated = Boolean(currentVersion && release.version && release.version !== currentVersion);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {release.version ? (
          <span className="font-medium text-ink">Latest version {release.version}</span>
        ) : (
          <span className="text-ink-muted">Latest release</span>
        )}
        {release.publishedAt && <span className="text-ink-faint">released {new Date(release.publishedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>}
        {currentVersion &&
          (outdated ? (
            <span className="rounded-full bg-amber/15 px-2 py-0.5 text-xs font-medium text-amber">You have {currentVersion} — update available</span>
          ) : (
            release.version && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">You’re up to date</span>
          ))}
      </div>
      <ul className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}>
        {sorted.map((d) => {
          const Icon = ICONS[d.platform];
          const highlighted = d.platform === mine;
          return (
            <li key={d.platform}>
              <a
                href={d.url}
                className={cn(
                  'group flex h-full items-center gap-3 rounded-2xl border p-4 transition-colors',
                  highlighted ? 'border-cyan/50 bg-cyan/10 hover:bg-cyan/15' : 'border-line bg-bg-elevated/50 hover:border-line-strong',
                )}
              >
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', highlighted ? 'bg-cyan text-on-accent' : 'bg-white/5 text-ink')}>
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {d.label}
                    {highlighted && <span className="ml-2 text-xs font-normal text-cyan">your device</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {d.detail}
                    {d.size ? ` · ${formatSize(d.size)}` : ''}
                  </span>
                </span>
                <Download size={17} className="shrink-0 text-ink-muted group-hover:text-ink" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-faint">
        All versions and release notes are on{' '}
        <a href={RELEASES_URL} className="underline underline-offset-4 hover:text-ink">
          GitHub
        </a>
        . Mac shows a security warning the first time: click Done, then System Settings → Privacy & Security → Open Anyway. On Windows: More info → Run anyway. Intel Macs need the Intel version.
      </p>
    </div>
  );
}
