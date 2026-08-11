import type { IncomingMessage } from 'node:http';

import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { WebSocket } from 'ws';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';

import type { ApiEnvironment } from '@instaclone/config';

import { ACCESS_COOKIE } from '../auth/auth.constants';
import { AccessSessionAuthenticator } from '../auth/access-session-authenticator';
import type { RequestIdentity } from '../auth/authenticated-request';
import { readCookieHeader } from './cookie-header';
import { NotificationRealtimeHub } from './notification-realtime.hub';

@WebSocketGateway({ path: '/api/v1/realtime' })
export class NotificationRealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly revalidationTimers = new WeakMap<WebSocket, NodeJS.Timeout>();

  constructor(
    private readonly authenticator: AccessSessionAuthenticator,
    private readonly hub: NotificationRealtimeHub,
    config: ConfigService<ApiEnvironment, true>,
    private readonly logger: PinoLogger,
  ) {
    this.allowedOrigins = new Set(config.get('API_CORS_ORIGINS', { infer: true }));
    this.logger.setContext(NotificationRealtimeGateway.name);
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    const origin = request.headers.origin;
    if (!origin || !this.allowedOrigins.has(origin)) {
      client.close(1008, 'Connection rejected');
      this.logger.warn({ originPresent: Boolean(origin) }, 'realtime connection origin rejected');
      return;
    }
    const token = readCookieHeader(request.headers.cookie, ACCESS_COOKIE);
    let identity: RequestIdentity | null;
    try {
      identity = await this.authenticator.authenticate(token);
    } catch (error) {
      client.close(1011, 'Connection unavailable');
      this.logger.warn({ error }, 'realtime authentication dependency failed');
      return;
    }
    if (!identity) {
      client.close(1008, 'Authentication required');
      this.logger.warn('unauthenticated realtime connection rejected');
      return;
    }
    const connectionCount = this.hub.add(identity.id, client);
    const timer = setInterval(() => {
      void this.revalidate(client, token);
    }, 60_000);
    timer.unref();
    this.revalidationTimers.set(client, timer);
    this.logger.info({ userId: identity.id, connectionCount }, 'realtime connection established');
  }

  handleDisconnect(client: WebSocket): void {
    const timer = this.revalidationTimers.get(client);
    if (timer) clearInterval(timer);
    this.revalidationTimers.delete(client);
    const removed = this.hub.remove(client);
    if (removed) {
      this.logger.info(
        { userId: removed.userId, connectionCount: removed.remaining },
        'realtime connection closed',
      );
    }
  }

  private async revalidate(client: WebSocket, token: string | null): Promise<void> {
    try {
      if (await this.authenticator.authenticate(token)) return;
      client.close(1008, 'Authentication expired');
    } catch (error) {
      client.close(1011, 'Connection unavailable');
      this.logger.warn({ error }, 'realtime revalidation dependency failed');
    }
  }
}
