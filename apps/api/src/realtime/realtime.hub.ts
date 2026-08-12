import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { WebSocket } from 'ws';

import {
  applicationRealtimeMessageSchema,
  type ApplicationRealtimeMessage,
} from '@instaclone/api-contracts';

@Injectable()
export class RealtimeHub {
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly owners = new WeakMap<WebSocket, string>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(RealtimeHub.name);
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

  deliver(recipientId: string, input: ApplicationRealtimeMessage): number {
    const message = applicationRealtimeMessageSchema.parse(input);
    const serialized = JSON.stringify(message);
    const sockets = this.connections.get(recipientId);
    let delivered = 0;
    for (const socket of sockets ?? []) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(serialized);
      delivered += 1;
    }
    this.logger.info(
      {
        recipientId,
        eventName: message.event,
        connectionCount: sockets?.size ?? 0,
        deliveryCount: delivered,
      },
      'realtime delivery attempted',
    );
    return delivered;
  }
}
