import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WebSocket } from 'ws';

import {
  NOTIFICATION_CREATED_MESSAGE,
  realtimeNotificationMessageSchema,
  type RealtimeNotificationPayload,
} from '@instaclone/api-contracts';

@Injectable()
export class NotificationRealtimeHub {
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly owners = new WeakMap<WebSocket, string>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(NotificationRealtimeHub.name);
  }

  add(userId: string, socket: WebSocket): number {
    const sockets = this.connections.get(userId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.connections.set(userId, sockets);
    this.owners.set(socket, userId);
    return sockets.size;
  }

  remove(socket: WebSocket): { userId: string; remaining: number } | null {
    const userId = this.owners.get(socket);
    if (!userId) return null;
    this.owners.delete(socket);
    const sockets = this.connections.get(userId);
    sockets?.delete(socket);
    if (!sockets?.size) this.connections.delete(userId);
    return { userId, remaining: sockets?.size ?? 0 };
  }

  deliver(recipientId: string, payload: RealtimeNotificationPayload): number {
    const message = JSON.stringify(
      realtimeNotificationMessageSchema.parse({
        event: NOTIFICATION_CREATED_MESSAGE,
        data: payload,
      }),
    );
    const sockets = this.connections.get(recipientId);
    let delivered = 0;
    for (const socket of sockets ?? []) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(message);
      delivered += 1;
    }
    this.logger.info(
      {
        recipientId,
        notificationId: payload.notification.id,
        connectionCount: sockets?.size ?? 0,
        deliveryCount: delivered,
      },
      'notification realtime delivery attempted',
    );
    return delivered;
  }
}
