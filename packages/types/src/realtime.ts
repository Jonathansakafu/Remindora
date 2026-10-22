import type { NotificationDTO, ProjectDTO, TaskDTO } from './dto';

/** Socket.IO event contract shared by the API gateway, workers (emitter) and clients. */
export interface ServerToClientEvents {
  'task.upserted': (payload: { task: TaskDTO; originSessionId?: string }) => void;
  'task.deleted': (payload: { taskId: string; projectId: string; hard: boolean; originSessionId?: string }) => void;
  'project.upserted': (payload: { project: ProjectDTO; originSessionId?: string }) => void;
  'project.deleted': (payload: { projectId: string; originSessionId?: string }) => void;
  'notification.created': (payload: { notification: NotificationDTO }) => void;
  /** Fired the instant any device acknowledges/snoozes/completes — other devices must dismiss. */
  'notification.resolved': (payload: { notificationId: string; reminderId: string | null; resolution: string }) => void;
  'pairing.claimed': (payload: { pairingId: string; deviceName: string; platform: string; verificationCode: string }) => void;
  'pairing.completed': (payload: { pairingId: string; deviceId: string }) => void;
  'device.approval_requested': (payload: { challengeId: string; deviceName: string; platform: string; ipCountry: string | null }) => void;
  'session.revoked': (payload: { sessionId: string }) => void;
  'entitlements.changed': (payload: Record<string, never>) => void;
  'comment.created': (payload: { taskId: string; commentId: string }) => void;
}

export interface ClientToServerEvents {
  'workspace.join': (workspaceId: string, ack: (ok: boolean) => void) => void;
  'presence.ping': () => void;
}

export const realtimeRooms = {
  user: (id: string) => `user:${id}`,
  session: (id: string) => `session:${id}`,
  workspace: (id: string) => `workspace:${id}`,
};
