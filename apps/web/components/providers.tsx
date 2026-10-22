'use client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { TooltipProvider } from '@remindora/ui';
import { createStore, del, get, set } from 'idb-keyval';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { initOutbox, useSync } from '@/lib/offline';
import { refreshSession, useSession } from '@/lib/session';
import { useUi } from '@/lib/ui-store';

/** Query cache persisted to IndexedDB so the app opens instantly — and offline — with the last known data. */
function makePersister() {
  if (typeof indexedDB === 'undefined') return undefined;
  const store = createStore('remindora-cache', 'queries');
  return createAsyncStoragePersister({
    storage: { getItem: (k) => get(k, store), setItem: (k, v) => set(k, v, store), removeItem: (k) => del(k, store) },
    throttleTime: 1500,
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            gcTime: 7 * 86_400_000,
            networkMode: 'offlineFirst',
            retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
            refetchOnWindowFocus: true,
          },
          mutations: { networkMode: 'always' },
        },
      }),
  );
  const [persister] = useState(makePersister);
  const theme = useUi((s) => s.theme);
  const motion = useUi((s) => s.motion);
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
    else delete document.documentElement.dataset.motion;
  }, [theme, motion]);

  useEffect(() => {
    void initOutbox();
    if (useSession.getState().status === 'loading') {
      void refreshSession().then((ok) => {
        if (!ok && useSession.getState().status === 'loading') useSession.setState({ status: 'signed_out' });
      });
    }
    const on = () => useSync.getState().setOnline(true);
    const off = () => useSync.getState().setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Never show one account's cached data to another.
  useEffect(() => {
    if (status === 'signed_out') qc.clear();
  }, [status, qc]);

  const toaster = <Toaster theme={theme === 'daybreak' ? 'light' : 'dark'} position="bottom-right" toastOptions={{ className: 'glass-strong !rounded-2xl !text-ink' }} />;
  if (!persister) {
    return (
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
        {toaster}
      </QueryClientProvider>
    );
  }
  return (
    <PersistQueryClientProvider client={qc} persistOptions={{ persister, maxAge: 7 * 86_400_000, buster: userId ?? 'anon' }}>
      <TooltipProvider>{children}</TooltipProvider>
      {toaster}
    </PersistQueryClientProvider>
  );
}
