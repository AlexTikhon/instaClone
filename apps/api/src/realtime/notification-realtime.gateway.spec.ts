import type { IncomingMessage } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { NotificationRealtimeGateway } from './notification-realtime.gateway';

const request = (cookie?: string, origin = 'http://localhost:3000') =>
  ({ headers: { cookie, origin } }) as IncomingMessage;

const socket = () => ({ close: vi.fn() });

const identity = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'user@example.com',
  emailVerified: true,
  profile: {
    userId: '10000000-0000-4000-8000-000000000001',
    username: 'user',
    displayName: 'User',
    bio: '',
    websiteUrl: null,
    isPrivate: false,
  },
  sessionId: '10000000-0000-4000-8000-000000000002',
};

const setup = (authenticated = true) => {
  const authenticator = {
    authenticate: vi.fn().mockResolvedValue(authenticated ? identity : null),
  };
  const hub = { add: vi.fn().mockReturnValue(1), remove: vi.fn() };
  const config = { get: vi.fn().mockReturnValue(['http://localhost:3000']) };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  return {
    authenticator,
    hub,
    gateway: new NotificationRealtimeGateway(
      authenticator as never,
      hub as never,
      config as never,
      logger as never,
    ),
  };
};

describe('NotificationRealtimeGateway', () => {
  it('rejects an unauthenticated socket without trusting a user query parameter', async () => {
    const { gateway, hub } = setup(false);
    const client = socket();
    await gateway.handleConnection(
      client as never,
      request('ic_access=invalid', 'http://localhost:3000'),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Authentication required');
    expect(hub.add).not.toHaveBeenCalled();
  });

  it('accepts an allowed-origin cookie-authenticated socket', async () => {
    const { gateway, hub, authenticator } = setup();
    const client = socket();
    await gateway.handleConnection(client as never, request('ic_access=trusted-token'));
    expect(authenticator.authenticate).toHaveBeenCalledWith('trusted-token');
    expect(hub.add).toHaveBeenCalledWith(identity.id, client);
    expect(client.close).not.toHaveBeenCalled();
  });

  it('rejects cross-origin cookie handshakes before authentication', async () => {
    const { gateway, authenticator } = setup();
    const client = socket();
    await gateway.handleConnection(
      client as never,
      request('ic_access=token', 'https://evil.test'),
    );
    expect(client.close).toHaveBeenCalledWith(1008, 'Connection rejected');
    expect(authenticator.authenticate).not.toHaveBeenCalled();
  });
});
