import { Injectable } from '@nestjs/common';
import { realtimeRooms, type ClientToServerEvents, type ServerToClientEvents } from '@remindora/types';
import type { Server } from 'socket.io';

type Events = ServerToClientEvents;

/** Emits domain events to user / workspace / session rooms. Fan-out across API instances via the Redis adapter. */
@Injectable()
export class RealtimeService {
  private server: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

  attach(server: Server<ClientToServerEvents, ServerToClientEvents>) {
    this.server = server;
  }

  toUser<E extends keyof Events>(userId: string, event: E, ...args: Parameters<Events[E]>) {
    this.server?.to(realtimeRooms.user(userId)).emit(event, ...args);
  }

  toUsers<E extends keyof Events>(userIds: string[], event: E, ...args: Parameters<Events[E]>) {
    if (!userIds.length) return;
    this.server?.to(userIds.map(realtimeRooms.user)).emit(event, ...args);
  }

  toWorkspace<E extends keyof Events>(workspaceId: string, event: E, ...args: Parameters<Events[E]>) {
    this.server?.to(realtimeRooms.workspace(workspaceId)).emit(event, ...args);
  }

  toSession<E extends keyof Events>(sessionId: string, event: E, ...args: Parameters<Events[E]>) {
    this.server?.to(realtimeRooms.session(sessionId)).emit(event, ...args);
  }

  /** Adds every socket of a user to a workspace room (e.g. after accepting an invite). */
  joinWorkspace(userId: string, workspaceId: string) {
    this.server?.in(realtimeRooms.user(userId)).socketsJoin(realtimeRooms.workspace(workspaceId));
  }

  leaveWorkspace(userId: string, workspaceId: string) {
    this.server?.in(realtimeRooms.user(userId)).socketsLeave(realtimeRooms.workspace(workspaceId));
  }

  /** Tells the session it was revoked, then drops its sockets everywhere. */
  revokeSession(sessionId: string) {
    this.toSession(sessionId, 'session.revoked', { sessionId });
    this.server?.in(realtimeRooms.session(sessionId)).disconnectSockets(true);
  }
}
