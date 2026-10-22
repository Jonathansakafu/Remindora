import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { coalesceOutbox, type OutboxEntry } from '@remindora/core';
import { create } from 'zustand';
import { api, ApiError } from './api';

/** Offline outbox (AsyncStorage). Same semantics as the web: clientId for creates, baseVersion for edits. */
const KEY = 'remindora.outbox';

export const useSync = create<{ online: boolean; pending: number; syncing: boolean }>(() => ({ online: true, pending: 0, syncing: false }));

async function read(): Promise<OutboxEntry[]> {
  return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as OutboxEntry[];
}
async function write(entries: OutboxEntry[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  useSync.setState({ pending: entries.length });
}

export async function mutateOrQueue<T>(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>): Promise<T | null> {
  const queue = async () => {
    const entries = await read();
    entries.push({ ...entry, id: `${Date.now()}-${Math.random()}`, createdAt: new Date().toISOString(), attempts: 0 });
    await write(coalesceOutbox(entries));
    return null;
  };
  if (!useSync.getState().online) return queue();
  try {
    return await api<T>(entry.path, { method: entry.method, body: entry.body });
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) {
      useSync.setState({ online: false });
      return queue();
    }
    throw e;
  }
}

let flushing = false;
export async function flushOutbox(onDone?: () => void) {
  if (flushing) return;
  flushing = true;
  useSync.setState({ syncing: true });
  try {
    let entries = coalesceOutbox(await read());
    while (entries.length) {
      try {
        await api(entries[0]!.path, { method: entries[0]!.method, body: entries[0]!.body });
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) break;
        // Conflicts / rejected writes: the server copy wins on mobile; the web app offers manual resolution.
      }
      entries = entries.slice(1);
      await write(entries);
    }
    onDone?.();
  } finally {
    flushing = false;
    useSync.setState({ syncing: false });
  }
}

export function watchConnectivity(onReconnect: () => void) {
  void read().then((e) => useSync.setState({ pending: e.length }));
  return NetInfo.addEventListener((s) => {
    const online = !!s.isConnected && s.isInternetReachable !== false;
    const was = useSync.getState().online;
    useSync.setState({ online });
    if (online && !was) onReconnect();
  });
}
