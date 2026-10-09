import { HttpException, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayInit, SubscribeMessage, WebSocketGateway, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { MultiplayerRoomsService } from './multiplayer-rooms.service';

type Subscription = { roomId: string; version: string };

@WebSocketGateway({
  namespace: '/rooms',
  maxHttpBufferSize: 16384,
  cors: { origin: (origin, done) => done(null, allowedOrigin(origin)) },
})
export class MultiplayerRoomsGateway implements OnGatewayInit, OnModuleDestroy {
  private server: Namespace;
  private timer?: NodeJS.Timeout;
  private pumping = false;
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly auth: AuthService, private readonly rooms: MultiplayerRoomsService) {}

  afterInit(server: Namespace) {
    this.server = server;
    server.use(async (socket, next) => {
      try {
        if (process.env.ROOM_REALTIME_ENABLED === 'false') throw new Error('realtime disabled');
        if (!allowedOrigin(socket.handshake.headers.origin)) throw new Error('origin rejected');
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string' || token.length > 4096) throw new Error('missing token');
        const session = await this.auth.verifyActiveAuthorization(token);
        const samePlayer = [...server.sockets.values()].filter(row => row.data.playerId === session.playerId).length;
        if (server.sockets.size >= 1000 || samePlayer >= 5) throw new Error('connection limit');
        socket.data.token = token;
        socket.data.playerId = session.playerId;
        socket.data.requests = { count: 0, until: Date.now() + 60000 };
        socket.on('disconnect', () => this.subscriptions.delete(socket.id));
        next();
      } catch { next(new Error('room connection rejected')); }
    });
    this.timer = setInterval(() => void this.publishCommitted(), 500);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.subscriptions.clear();
  }

  @SubscribeMessage('room.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() input: unknown) {
    if (socket.data.recovering) return { error: { status: 429, message: 'recovery already running' } };
    socket.data.recovering = true;
    const generation = socket.data.subscriptionGeneration = (socket.data.subscriptionGeneration || 0) + 1;
    // Clearing first makes failed/superseded subscriptions fail closed.
    this.subscriptions.delete(socket.id);
    try {
      const bucket = socket.data.requests;
      if (bucket.until < Date.now()) { bucket.until = Date.now() + 60000; bucket.count = 0; }
      if (++bucket.count > 30) throw new Error('recovery rate limit');
      if (!input || typeof input !== 'object') throw new Error('invalid subscription');
      const { roomId, version } = input as { roomId: string; version?: unknown };
      const session = await this.auth.verifyActiveAuthorization(socket.data.token);
      const result = await this.rooms.recover(session.playerId, roomId, version);
      if (socket.connected && socket.data.subscriptionGeneration === generation) {
        this.subscriptions.set(socket.id, { roomId, version: result.version });
      }
      return result;
    } catch (error) {
      return { error: { status: error instanceof HttpException ? error.getStatus() : 400,
        message: error instanceof HttpException ? error.message : 'room recovery rejected' } };
    } finally { socket.data.recovering = false; }
  }

  @SubscribeMessage('room.unsubscribe')
  unsubscribe(@ConnectedSocket() socket: Socket) {
    socket.data.subscriptionGeneration = (socket.data.subscriptionGeneration || 0) + 1;
    this.subscriptions.delete(socket.id);
    return { ok: true };
  }

  // Each instance tails committed DB history for its own connections. Redis is
  // deliberately not a delivery dependency in this first, bounded room slice.
  private async publishCommitted() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (const socket of this.server.sockets.values()) {
        try {
          const session = await this.auth.verifyActiveAuthorization(socket.data.token);
          const subscription = this.subscriptions.get(socket.id);
          if (!subscription) continue;
          const result = await this.rooms.recover(session.playerId, subscription.roomId, subscription.version);
          if (!socket.connected || this.subscriptions.get(socket.id) !== subscription) continue;
          if (result.mode === 'snapshot') socket.emit('room.sync', result);
          else for (const event of result.events || []) socket.emit('room.event', event);
          subscription.version = result.version;
        } catch (error) {
          if (error instanceof HttpException && [400, 401, 403, 404].includes(error.getStatus())) {
            this.subscriptions.delete(socket.id);
            socket.emit('room.revoked');
            socket.disconnect(true);
          }
          // A database outage sends nothing; HTTP fallback and next tail retry.
        }
      }
    } finally { this.pumping = false; }
  }
}

function allowedOrigin(origin?: string) {
  const configured = process.env.CORS_ORIGIN || '*';
  if (!origin) return true; // Non-browser clients still require authentication.
  return configured === '*' || configured.split(',').map(value => value.trim()).includes(origin);
}
