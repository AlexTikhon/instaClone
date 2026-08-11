import { describe, expect, it, vi } from 'vitest';

import { NotificationRealtimeHub } from './notification-realtime.hub';

const payload = {
  notification: {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'FOLLOW' as const,
    createdAt: '2026-08-11T12:00:00.000Z',
    readAt: null,
    actor: {
      id: '10000000-0000-4000-8000-000000000002',
      username: 'alex',
      displayName: 'Alex',
      isAvailable: true,
    },
    target: { postId: null, commentId: null, contentAvailable: null },
  },
};

const socket = () => ({ readyState: 1, send: vi.fn() });

describe('NotificationRealtimeHub', () => {
  it('sends to every connection for the intended user and no unrelated user', () => {
    const hub = new NotificationRealtimeHub({ setContext: vi.fn(), info: vi.fn() } as never);
    const first = socket();
    const second = socket();
    const unrelated = socket();
    hub.add('recipient', first as never);
    hub.add('recipient', second as never);
    hub.add('other', unrelated as never);
    expect(hub.deliver('recipient', payload)).toBe(2);
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();
    expect(unrelated.send).not.toHaveBeenCalled();
  });
});
