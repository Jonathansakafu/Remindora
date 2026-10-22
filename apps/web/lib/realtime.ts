'use client';
import type { QueryClient } from '@tanstack/react-query';
import type { ClientToServerEvents, NotificationDTO, ServerToClientEvents, TaskDTO } from '@remindora/types';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { api } from './api';
import { API_URL } from './config';
import { flushOutbox, useSync } from './offline';
import { dismissNative, nativeNotify } from './platform';
import { keys, patchTaskCaches, removeTaskFromCaches, scheduleTaskRefetch } from './queries';
import { refreshSession, useSession } from './session';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
const listeners = new Map<string, Set<(payload: unknown) => void>>();

/** Subscribe to a realtime event regardless of when (or how often) the socket connects. */
export function onRealtime<E extends keyof ServerToClientEvents>(event: E, handler: (payload: Parameters<ServerToClientEvents[E]>[0]) => void): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(handler as (p: unknown) => void);
  listeners.set(event, set);
  return () => void set.delete(handler as (p: unknown) => void);
}

/**
 * Connects the realtime channel and keeps caches in sync with other devices.
 * Echoes of this session's own writes are ignored (originSessionId).
 */
export function connectRealtime(qc: QueryClient, handlers: { onOpenTask: (id: string) => void }) {
  disconnectRealtime();
  const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
    path: '/realtime',
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: useSession.getState().accessToken }),
    reconnectionDelayMax: 15_000,
  });
  socket = s;
  s.onAny((event: string, payload: unknown) => listeners.get(event)?.forEach((fn) => fn(payload)));
  const mine = (origin?: string) => origin && origin === useSession.getState().sessionId;

  s.on('connect', () => {
    useSync.getState().setOnline(true);
    void flushOutbox(() => scheduleTaskRefetch(qc));
    qc.invalidateQueries({ queryKey: keys.notifications });
  });
  s.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') await refreshSession();
  });

  s.on('task.upserted', ({ task, originSessionId }) => {
    if (mine(originSessionId)) return;
    patchTaskCaches(qc, task as TaskDTO);
    scheduleTaskRefetch(qc);
  });
  s.on('task.deleted', ({ taskId, originSessionId }) => {
    if (mine(originSessionId)) return;
    removeTaskFromCaches(qc, taskId);
    scheduleTaskRefetch(qc);
  });
  s.on('project.upserted', () => qc.invalidateQueries({ queryKey: keys.projects }));
  s.on('project.deleted', () => qc.invalidateQueries({ queryKey: keys.projects }));
  s.on('comment.created', ({ taskId }) => qc.invalidateQueries({ queryKey: ['comments', taskId] }));
  s.on('entitlements.changed', () => qc.invalidateQueries({ queryKey: keys.entitlements }));
  s.on('session.revoked', async () => {
    toast.error('This device was signed out');
    await useSession.getState().clear();
  });

  s.on('notification.created', ({ notification, alert }) => {
    qc.setQueryData<{ items: NotificationDTO[]; unread: number }>(keys.notifications, (prev) =>
      prev ? { items: [notification, ...prev.items.filter((n) => n.id !== notification.id)], unread: prev.unread + 1 } : prev,
    );
    const open = () => notification.taskId && handlers.onOpenTask(notification.taskId);
    if (alert?.desktop || alert?.webPush) {
      void nativeNotify({ title: notification.title, body: notification.body, tag: notification.reminderId ?? notification.id, urgent: notification.priority === 'CRITICAL', onClick: open });
    }
    if (notification.kind === 'REMINDER' && alert?.sound !== false) {
      toast(notification.title, {
        description: notification.body,
        duration: notification.priority === 'CRITICAL' ? Infinity : 8000,
        action: notification.taskId ? { label: 'Complete', onClick: () => api(`/notifications/${notification.id}/action`, { body: { action: 'complete' } }) } : undefined,
        cancel: { label: 'Snooze 10m', onClick: () => api(`/notifications/${notification.id}/action`, { body: { action: 'snooze', snoozeMinutes: 10 } }) },
      });
    }
  });
  s.on('notification.resolved', ({ notificationId, reminderId }) => {
    dismissNative(reminderId ?? notificationId);
    qc.setQueryData<{ items: NotificationDTO[]; unread: number }>(keys.notifications, (prev) =>
      prev ? { ...prev, items: prev.items.map((n) => (n.id === notificationId ? { ...n, acknowledgedAt: new Date().toISOString(), readAt: n.readAt ?? new Date().toISOString() } : n)) } : prev,
    );
  });
  return s;
}

export function getSocket() {
  return socket;
}

export function disconnectRealtime() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
