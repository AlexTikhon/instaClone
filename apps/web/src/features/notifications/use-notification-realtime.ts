'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { realtimeNotificationMessageSchema } from '@instaclone/api-contracts';

import { apiBaseUrl } from '../../shared/api/http-client';
import { queryKeys } from '../feed/query-keys';
import { mergeRealtimeNotification, type NotificationsCache } from './notification-cache';

export const notificationRealtimeUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) return configured;
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '').replace(/\/api\/v1$/, '')}/api/v1/realtime`;
  url.search = '';
  return url.toString();
};

export const useNotificationRealtime = (): void => {
  const client = useQueryClient();
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(notificationRealtimeUrl());
      socket.addEventListener('open', () => {
        attempt = 0;
        void client.invalidateQueries({ queryKey: queryKeys.notifications });
      });
      socket.addEventListener('message', (event) => {
        try {
          const parsed = realtimeNotificationMessageSchema.parse(JSON.parse(String(event.data)));
          client.setQueryData<NotificationsCache>(queryKeys.notifications, (current) =>
            mergeRealtimeNotification(current, parsed.data.notification),
          );
        } catch {
          // Ignore malformed or unrelated server messages; REST remains authoritative.
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
  }, [client]);
};
