import { act, render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { queryKeys } from '../feed/query-keys';
import { messagingKeys } from '../messaging/query-keys';
import type { NotificationsCache } from '../notifications/notification-cache';
import { useApplicationRealtime } from './use-application-realtime';

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  emit(name: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  close(): void {
    this.closed = true;
  }
}

const viewerA = '20000000-0000-4000-8000-00000000000a';
const viewerB = '20000000-0000-4000-8000-00000000000b';

const notificationHint = (id: string) =>
  JSON.stringify({
    event: 'NOTIFICATION_CREATED',
    data: {
      notification: {
        id,
        type: 'LIKE',
        createdAt: new Date().toISOString(),
        readAt: null,
        actor: { id: null, username: 'ada', displayName: 'Ada', isAvailable: true },
        target: { postId: null, commentId: null, contentAvailable: null },
      },
    },
  });

const messageHint = (conversationId: string) =>
  JSON.stringify({
    event: 'MESSAGE_CREATED',
    data: {
      conversationId,
      messageId: crypto.randomUUID(),
      senderId: crypto.randomUUID(),
      sequence: 1,
      occurredAt: new Date().toISOString(),
    },
  });

describe('useApplicationRealtime', () => {
  let client: QueryClient;
  let invalidate: MockInstance<QueryClient['invalidateQueries']>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const mount = (viewer: string | null) =>
    renderHook(({ id }: { id: string | null }) => useApplicationRealtime(id), {
      wrapper,
      initialProps: { id: viewer },
    });
  const socket = (index: number): FakeWebSocket => {
    const instance = FakeWebSocket.instances[index];
    if (!instance) throw new Error(`socket ${index} was never opened`);
    return instance;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    client = new QueryClient();
    invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not connect without an authenticated viewer', () => {
    renderHook(() => useApplicationRealtime(null), { wrapper });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('keeps one socket across re-renders for the same viewer', () => {
    const { rerender } = mount(viewerA);
    rerender({ id: viewerA });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket(0).closed).toBe(false);
  });

  it('closes the old socket and cancels its reconnect timer when the viewer changes', () => {
    const { rerender } = mount(viewerA);
    act(() => socket(0).emit('close'));
    // The reconnect timer for A is now pending; the viewer change must cancel it.
    rerender({ id: viewerB });
    expect(socket(0).closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(socket(1).closed).toBe(false);
  });

  it('closes the socket and stops reconnecting on logout', () => {
    const { rerender } = mount(viewerA);
    rerender({ id: null });
    expect(socket(0).closed).toBe(true);
    act(() => socket(0).emit('close'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('ignores every event from a stale socket after teardown and never reconnects it', () => {
    const { rerender } = mount(viewerA);
    const stale = socket(0);
    rerender({ id: viewerB });
    invalidate.mockClear();
    const conversationId = crypto.randomUUID();

    act(() => {
      stale.emit('open');
      stale.emit('message', { data: notificationHint(crypto.randomUUID()) });
      stale.emit('message', { data: messageHint(conversationId) });
      stale.emit('close');
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(client.getQueryData<NotificationsCache>(queryKeys.notifications)).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('still applies events from the live socket of the current viewer', () => {
    const { rerender } = mount(viewerA);
    rerender({ id: viewerB });
    const notificationId = crypto.randomUUID();
    act(() => socket(1).emit('open'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.notifications });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messagingKeys.all });
    act(() => socket(1).emit('message', { data: notificationHint(notificationId) }));
    const cache = client.getQueryData<NotificationsCache>(queryKeys.notifications);
    expect(cache?.pages[0]?.items.map((item) => item.id)).toEqual([notificationId]);
  });

  it('survives StrictMode cleanup with exactly one live socket and no stray reconnects', () => {
    function Probe() {
      useApplicationRealtime(viewerA);
      return null;
    }
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(FakeWebSocket.instances).toHaveLength(2);
    const [simulated, live] = FakeWebSocket.instances;
    expect(simulated?.closed).toBe(true);
    expect(live?.closed).toBe(false);

    // The browser reports the simulated mount's close asynchronously.
    act(() => simulated?.emit('close'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => live?.emit('message', { data: notificationHint(crypto.randomUUID()) }));
    expect(client.getQueryData<NotificationsCache>(queryKeys.notifications)).toBeDefined();
  });
});
