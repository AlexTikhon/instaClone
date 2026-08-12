'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  applicationRealtimeMessageSchema,
  MESSAGE_CREATED_MESSAGE,
  NOTIFICATION_CREATED_MESSAGE,
} from '@instaclone/api-contracts';

import { apiBaseUrl } from '../../shared/api/http-client';
import { queryKeys } from '../feed/query-keys';
import { messagingKeys } from '../messaging/query-keys';
import {
  mergeRealtimeNotification,
  type NotificationsCache,
} from '../notifications/notification-cache';

export const applicationRealtimeUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) return configured;
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/api\/v1$/, '')}/api/v1/realtime`;
  url.search = '';
  return url.toString();
};

export const useApplicationRealtime = (enabled = true): void => {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const recover = () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.notifications }),
        client.invalidateQueries({ queryKey: messagingKeys.all }),
      ]);

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(applicationRealtimeUrl());
      socket.addEventListener('open', () => {
        attempt = 0;
        void recover();
      });
      socket.addEventListener('message', (event) => {
        try {
          const parsed = applicationRealtimeMessageSchema.parse(JSON.parse(String(event.data)));
          if (parsed.event === NOTIFICATION_CREATED_MESSAGE) {
            client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
              mergeRealtimeNotification(current, parsed.data.notification),
            );
            return;
          }
          if (parsed.event === MESSAGE_CREATED_MESSAGE) {
            void Promise.all([
              client.invalidateQueries({ queryKey: messagingKeys.conversations() }),
              client.invalidateQueries({
                queryKey: messagingKeys.conversation(parsed.data.conversationId),
              }),
              client.invalidateQueries({
                queryKey: messagingKeys.messages(parsed.data.conversationId),
              }),
            ]);
          }
        } catch {
          // Invalid hints are ignored. Authenticated HTTP recovery remains authoritative.
        }
      });
      socket.addEventListener('close', () => {
        if (stopped) return;
        const delay = Math.min(30_000, 1_000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [client, enabled]);
};
