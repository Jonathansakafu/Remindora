import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { realtimeRooms, type ClientToServerEvents, type ServerToClientEvents } from '@remindora/types';
import type { Server, Socket } from 'socket.io';
import { AccessService } from '../common/access.service';
import { AuthGuard } from '../common/auth';
import { RealtimeService } from './realtime.service';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { userId: string; sessionId: string; deviceId: string }>;

/**
 * Socket.IO gateway. Clients connect with `auth: { token: <access token> }`; the
 * same session checks as HTTP apply. Each socket joins its user, session and
 * workspace rooms. CORS is configured by the Redis-backed IoAdapter in bootstrap.
 */
@WebSocketGateway({ path: '/realtime', transports: ['websocket', 'polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly realtime: RealtimeService,
    private readonly guard: AuthGuard,
    private readonly access: AccessService,
  ) {}

  afterInit(server: Server<ClientToServerEvents, ServerToClientEvents>) {
    this.realtime.attach(server);
    server.use(async (socket: AppSocket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: string })?.token;
        if (!token) return next(new Error('unauthorized'));
        const auth = await this.guard.authenticate(token);
        socket.data = { userId: auth.userId, sessionId: auth.sessionId, deviceId: auth.deviceId };
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  async handleConnection(socket: AppSocket) {
    const { userId, sessionId } = socket.data;
    if (!userId) return socket.disconnect(true);
    const workspaces = await this.access.workspaceIds(userId);
    await socket.join([realtimeRooms.user(userId), realtimeRooms.session(sessionId), ...workspaces.map(realtimeRooms.workspace)]);
    socket.on('workspace.join', async (workspaceId, ack) => {
      const ok = (await this.access.workspaceIds(userId)).includes(workspaceId);
      if (ok) await socket.join(realtimeRooms.workspace(workspaceId));
      ack?.(ok);
    });
    socket.on('presence.ping', () => undefined);
    this.logger.debug(`socket connected user=${userId}`);
  }
}
