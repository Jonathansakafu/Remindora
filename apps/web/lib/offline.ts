'use client';
import { coalesceOutbox, type OutboxEntry } from '@remindora/core';
import { createStore, del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import { api, ApiError } from './api';

/**
 * Offline outbox. Mutations made while offline are queued in IndexedDB and
 * replayed in order once the connection returns. Creates carry a clientId (so
 * replays are idempotent) and edits carry baseVersion (so concurrent edits are
 * detected field-by-field). Conflicts are surfaced for the user to resolve.
 */

const store = typeof indexedDB !== 'undefined' ? createStore('remindora-outbox', 'entries') : undefined;
const KEY = 'entries';

export interface Conflict {
  id: string;
  taskId: string;
  fields: string[];
  mine: Record<string, unknown>;
  server: { title: string } & Record<string, unknown>;
}

interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
  conflicts: Conflict[];
  lastSyncedAt: number | null;
  setOnline: (o: boolean) => void;
  resolve: (id: string) => void;
}

export const useSync = create<SyncState>((setState) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  conflicts: [],
  lastSyncedAt: null,
  setOnline: (online) => setState({ online }),
  resolve: (id) => setState((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) })),
}));

async function read(): Promise<OutboxEntry[]> {
  return store ? ((await get<OutboxEntry[]>(KEY, store)) ?? []) : [];
}

async function write(entries: OutboxEntry[]) {
  if (!store) return;
  if (entries.length) await set(KEY, entries, store);
  else await del(KEY, store);
  useSync.setState({ pending: entries.length });
}

export async function enqueue(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>) {
  const entries = await read();
  entries.push({ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0 });
  await write(coalesceOutbox(entries));
}

/** Runs a mutation now, or queues it if we're offline. Returns null when queued. */
export async function mutateOrQueue<T>(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>): Promise<T | null> {
  if (!useSync.getState().online) {
    await enqueue(entry);
    return null;
  }
  try {
    return await api<T>(entry.path, { method: entry.method, body: entry.body });
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      useSync.getState().setOnline(false);
      await enqueue(entry);
      return null;
    }
    throw e;
  }
}

let flushing = false;
export async function flushOutbox(onApplied?: () => void) {
  if (flushing) return;
  flushing = true;
  useSync.setState({ syncing: true });
  try {
    let entries = coalesceOutbox(await read());
    while (entries.length) {
      const e = entries[0]!;
      try {
        await api(e.path, { method: e.method, body: e.body });
      } catch (err) {
        if (err instanceof ApiError && err.isNetwork) break;
        if (err instanceof ApiError && err.code === 'edit_conflict') {
          const d = err.details as { fields: string[]; server: Conflict['server'] & { id: string } };
          useSync.setState((s) => ({ conflicts: [...s.conflicts, { id: e.id, taskId: d.server.id, fields: d.fields, mine: e.body as Record<string, unknown>, server: d.server }] }));
        }
        // Other 4xx: the server rejected it (deleted task, revoked access…); drop it.
      }
      entries = entries.slice(1);
      await write(entries);
    }
    useSync.setState({ lastSyncedAt: Date.now() });
    onApplied?.();
  } finally {
    flushing = false;
    useSync.setState({ syncing: false });
  }
}

export async function initOutbox() {
  useSync.setState({ pending: (await read()).length });
}
