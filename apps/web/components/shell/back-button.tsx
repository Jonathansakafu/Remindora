'use client';
import { ChevronLeft } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Main screens (bottom bar / sidebar). Everything else is a sub-page with a Back button. */
const MAIN = ['/app/reminders', '/app/checklist', '/app/stopwatch', '/app/more'];

function parentOf(path: string) {
  if (path.startsWith('/app/settings/')) return '/app/settings';
  return '/app/more';
}

/**
 * "‹ Back" for sub-pages: returns to the previous in-app page — unless that page is below this
 * one (we just went "up" from it) or there is none (opened from a link or notification); then
 * it goes up to the logical parent, so Back never ping-pongs.
 */
export function BackButton() {
  const pathname = usePathname().replace(/\/$/, '');
  const router = useRouter();
  const history = useRef<string[]>([]);
  useEffect(() => {
    const h = history.current;
    if (h[h.length - 1] !== pathname) h.push(pathname);
  }, [pathname]);

  if (MAIN.includes(pathname)) return null;

  function goBack() {
    const h = history.current;
    const previous = h[h.length - 2];
    const cameUpFromChild = previous?.startsWith(`${pathname}/`);
    if (previous && !cameUpFromChild) {
      h.pop();
      router.back();
    } else {
      router.push(parentOf(pathname));
    }
  }

  return (
    <button type="button" onClick={goBack} className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-xl pl-1 pr-2.5 text-sm font-medium text-ink-muted hover:bg-white/5 hover:text-ink" aria-label="Back">
      <ChevronLeft size={19} /> Back
    </button>
  );
}
