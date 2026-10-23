import type { ClientToServerEvents, ServerToClientEvents, TaskDTO } from '@remindora/types';
import type { QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { flushOutbox } from './offline';
import { keys, patchTask, refetchTasks } from './queries';
import { useSession } from './session';
import { useAlarm } from './alarm';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function connectRealtime(qc: QueryClient) {
  socket?.disconnect();
  const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, { path: '/realtime', transports: ['websocket'], auth: (cb) => cb({ token: useSession.getState().accessToken }) });
  socket = s;
  const mine = (o?: string) => o && o === useSession.getState().sessionId;
  s.on('connect', () => void flushOutbox(() => refetchTasks(qc)));
  s.on('task.upserted', ({ task, originSessionId }) => {
    if (mine(originSessionId)) return;
    patchTask(qc, task as TaskDTO);
    refetchTasks(qc);
  });
  s.on('task.deleted', () => refetchTasks(qc));
  s.on('project.upserted', () => void qc.invalidateQueries({ queryKey: keys.projects }));
  s.on('notification.created', ({ notification, alert }) => {
    void qc.invalidateQueries({ queryKey: keys.notifications });
    if (notification.kind === 'REMINDER' && alert?.sound !== false) {
      useAlarm.getState().ring({ notificationId: notification.id, taskId: notification.taskId, title: notification.title, body: notification.body, sound: String(notification.data?.sound ?? 'alarm') });
    }
  });
  // Resolved on another device: clear our tray copy immediately (the data push does this when we're in the background).
  s.on('notification.resolved', async ({ notificationId, reminderId }) => {
    void qc.invalidateQueries({ queryKey: keys.notifications });
    useAlarm.getState().dismiss(notificationId);
    await dismissPresented(notificationId, reminderId);
  });
  s.on('session.revoked', () => void useSession.getState().clear());
  return s;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export async function dismissPresented(notificationId: string, reminderId: string | null) {
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const n of presented) {
    const data = n.request.content.data as { notificationId?: string; reminderId?: string } | undefined;
    if (data?.notificationId === notificationId || (reminderId && data?.reminderId === reminderId)) {
      await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  }
}
