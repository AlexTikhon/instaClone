import {
  markAllNotificationsReadResponseSchema,
  markNotificationReadResponseSchema,
  notificationsResponseSchema,
  type MarkAllNotificationsReadResponse,
  type NotificationResponse,
  type NotificationsResponse,
} from '@instaclone/api-contracts';

import { getCsrfToken } from '../../lib/identity-api';
import { apiRequest } from '../../shared/api/http-client';

export const getNotifications = async (cursor?: string): Promise<NotificationsResponse> => {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const response = await apiRequest(`/notifications?${query.toString()}`);
  return notificationsResponseSchema.parse(await response.json());
};

const readMutation = async (path: string): Promise<Response> =>
  apiRequest(path, {
    method: 'PUT',
    headers: { 'x-csrf-token': await getCsrfToken() },
  });

export const markNotificationRead = async (
  notificationId: string,
): Promise<NotificationResponse> => {
  const response = await readMutation(`/notifications/${notificationId}/read`);
  return markNotificationReadResponseSchema.parse(await response.json());
};

export const markAllNotificationsRead = async (): Promise<MarkAllNotificationsReadResponse> => {
  const response = await readMutation('/notifications/read-all');
  return markAllNotificationsReadResponseSchema.parse(await response.json());
};
