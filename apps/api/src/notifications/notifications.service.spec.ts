import { describe, expect, it, vi } from 'vitest';

import { NotificationsService } from './notifications.service';

const recipientId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const notificationId = '10000000-0000-4000-8000-000000000003';

const row = (readAt: Date | null = null) => ({
  id: notificationId,
  type: 'FOLLOW' as const,
  createdAt: new Date('2026-08-11T12:00:00.000Z'),
  readAt,
  actorId,
  actorUsername: 'alex',
  actorDisplayName: 'Alex',
  postId: null,
  commentId: null,
  actor: {
    disabledAt: null,
    profile: {
      userId: actorId,
      username: 'alex',
      displayName: 'Alex',
      bio: '',
      websiteUrl: null,
      isPrivate: false,
    },
  },
  post: null,
  comment: null,
});

const setup = () => {
  const notification = {
    findMany: vi.fn().mockResolvedValue([row(), { ...row(), id: crypto.randomUUID() }]),
    count: vi.fn().mockResolvedValue(2),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
  return { notification, service: new NotificationsService({ notification } as never) };
};

describe('NotificationsService', () => {
  it('lists only the authenticated recipient with keyset pagination and unread count', async () => {
    const { service, notification } = setup();
    const result = await service.list(recipientId, { limit: 1 });
    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientId }, take: 2 }),
    );
    expect(result).toMatchObject({ hasMore: true, unreadCount: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeTruthy();
  });

  it('marks an unread owned notification and is idempotent once read', async () => {
    const { service, notification } = setup();
    notification.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(row(new Date()));
    notification.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.markRead(recipientId, notificationId);
    expect(result.id).toBe(notificationId);
    expect(typeof result.readAt).toBe('string');
    expect(notification.updateMany).toHaveBeenCalledOnce();

    notification.findFirst.mockResolvedValueOnce(row(new Date('2026-08-11T13:00:00.000Z')));
    await service.markRead(recipientId, notificationId);
    expect(notification.updateMany).toHaveBeenCalledOnce();
  });

  it('does not disclose another recipient notification and scopes mark-all', async () => {
    const { service, notification } = setup();
    notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(recipientId, notificationId)).rejects.toMatchObject({
      response: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification was not found' },
      status: 404,
    });
    notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead(recipientId)).resolves.toMatchObject({ updatedCount: 3 });
    expect(notification.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { recipientId, readAt: null } }),
    );
  });

  it('renders disabled actors and deleted content without throwing', async () => {
    const { service, notification } = setup();
    notification.findMany.mockResolvedValue([
      {
        ...row(),
        type: 'LIKE',
        postId: crypto.randomUUID(),
        actor: { ...row().actor, disabledAt: new Date() },
        post: { deletedAt: new Date() },
      },
    ]);
    const result = await service.list(recipientId, { limit: 20 });
    expect(result.items[0]).toMatchObject({
      actor: { id: null, isAvailable: false },
      target: { contentAvailable: false },
    });
  });
});
