import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

import { QueryProvider } from '../../app/query-provider';
import { IdentityPanel } from '../../components/identity-panel';
import { useApplicationRealtime } from '../realtime/use-application-realtime';
import { AuthProvider, useAuth } from './auth-provider';

const api = vi.hoisted(() => ({
  getCsrfToken: vi.fn(),
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  register: vi.fn(),
  updateOwnProfile: vi.fn(),
}));
vi.mock('../../lib/identity-api', () => api);
vi.mock('../create-post/create-post-form', () => ({ CreatePostForm: () => null }));
vi.mock('../create-story/create-story-form', () => ({ CreateStoryForm: () => null }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(): void {
    // Realtime messages are irrelevant to authentication ordering.
  }
  close(): void {
    this.closed = true;
  }
}

const openSockets = () => FakeWebSocket.instances.filter((socket) => !socket.closed);

// The socket opens in a passive effect, which may run just after the UI that gates it appears.
const liveSockets = async () => {
  await waitFor(() => expect(openSockets()).toHaveLength(1));
  return openSockets();
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const userOf = (id: string, username: string): AuthenticatedUser => ({
  id,
  email: `${username}@example.com`,
  emailVerified: true,
  role: 'USER',
  profile: {
    userId: id,
    username,
    displayName: username,
    bio: '',
    websiteUrl: null,
    isPrivate: false,
  },
});

const userA = userOf('20000000-0000-4000-8000-00000000000a', 'alice');
const userB = userOf('20000000-0000-4000-8000-00000000000b', 'bob');
const aliceUpdated = { ...userA.profile, displayName: 'Alice Updated' };

// Live handles refreshed after every commit so tests can observe the session.
const handles = {} as { auth: ReturnType<typeof useAuth>; client: QueryClient };

function Probe() {
  const auth = useAuth();
  const client = useQueryClient();
  useEffect(() => {
    handles.auth = auth;
    handles.client = client;
  });
  useApplicationRealtime(auth.user?.id ?? null);
  return null;
}

/**
 * Two independent IdentityPanels: the "profile" one can be unmounted (navigation) while the
 * "account" one stays mounted to drive logout and login, like separate screens would.
 */
function Shell() {
  const [showProfile, setShowProfile] = useState(true);
  const { loading } = useAuth();
  return (
    <>
      <Probe />
      <button type="button" onClick={() => setShowProfile(false)}>
        Leave profile
      </button>
      {!loading && (
        <>
          <div data-testid="profile-slot">{showProfile && <IdentityPanel />}</div>
          <div data-testid="account-slot">
            <IdentityPanel />
          </div>
        </>
      )}
    </>
  );
}

const renderApp = (strict = false) => {
  const tree = (
    <AuthProvider>
      <QueryProvider>
        <Shell />
      </QueryProvider>
    </AuthProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

const slot = (name: 'profile-slot' | 'account-slot') => within(screen.getByTestId(name));

// Waits for the rendered account and for the effect-driven handles to catch up with it.
const loggedInAs = async (username: string) =>
  waitFor(() => {
    expect(slot('account-slot').getByRole('heading', { name: `@${username}` })).toBeInTheDocument();
    expect(handles.auth.user?.profile.username).toBe(username);
  });

const startProfileSave = async (profile = deferred<AuthenticatedUser['profile']>()) => {
  api.updateOwnProfile.mockReturnValueOnce(profile.promise);
  fireEvent.click(slot('profile-slot').getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(api.updateOwnProfile).toHaveBeenCalledOnce());
  return profile;
};

const logOut = async () => {
  fireEvent.click(slot('account-slot').getByRole('button', { name: 'Log out' }));
  await waitFor(() => expect(slot('account-slot').getByLabelText('Email')).toBeInTheDocument());
};

const logIn = async (user: AuthenticatedUser) => {
  api.login.mockResolvedValueOnce(user);
  const account = slot('account-slot');
  fireEvent.click(account.getByRole('button', { name: 'Log in' }));
  fireEvent.change(account.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(account.getByLabelText('Password'), { target: { value: 'correct horse' } });
  fireEvent.submit(account.getByLabelText('Email').closest('form')!);
  await loggedInAs(user.profile.username);
};

const settle = (action: () => void) =>
  act(async () => {
    action();
    await Promise.resolve();
  });

describe('authentication session guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    api.getCsrfToken.mockResolvedValue('csrf');
    api.getCurrentUser.mockResolvedValue(userA);
    api.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps account B signed in when account A's profile save settles after A left and B signed in", async () => {
    renderApp();
    await loggedInAs('alice');
    const save = await startProfileSave();

    fireEvent.click(screen.getByRole('button', { name: 'Leave profile' }));
    await logOut();
    await logIn(userB);
    const clientOfB = handles.client;
    const socketsOfB = await liveSockets();
    expect(socketsOfB).toHaveLength(1);

    await settle(() => save.resolve(aliceUpdated));

    expect(handles.auth.user).toEqual(userB);
    expect(slot('account-slot').getByRole('heading', { name: '@bob' })).toBeInTheDocument();
    expect(handles.client).toBe(clientOfB);
    expect(openSockets()).toEqual(socketsOfB);
  });

  it('ignores a stale profile save after logging out and back in as the same account', async () => {
    renderApp();
    await loggedInAs('alice');
    const save = await startProfileSave();

    fireEvent.click(screen.getByRole('button', { name: 'Leave profile' }));
    await logOut();
    const newerAlice = { ...userA, profile: { ...userA.profile, bio: 'second session' } };
    await logIn(newerAlice);
    const clientOfSecondSession = handles.client;
    const socketsOfSecondSession = await liveSockets();

    await settle(() => save.resolve(aliceUpdated));

    expect(handles.auth.user).toEqual(newerAlice);
    expect(handles.client).toBe(clientOfSecondSession);
    expect(openSockets()).toEqual(socketsOfSecondSession);
  });

  it('stays anonymous when a profile save settles after logout', async () => {
    renderApp();
    await loggedInAs('alice');
    const save = await startProfileSave();

    fireEvent.click(screen.getByRole('button', { name: 'Leave profile' }));
    await logOut();
    const anonymousClient = handles.client;

    await settle(() => save.resolve(aliceUpdated));

    expect(handles.auth.user).toBeNull();
    expect(slot('account-slot').queryByRole('heading', { name: '@alice' })).toBeNull();
    expect(slot('account-slot').getByLabelText('Email')).toBeInTheDocument();
    expect(handles.client).toBe(anonymousClient);
    expect(openSockets()).toHaveLength(0);
  });

  it.each([
    ['', false],
    [' under StrictMode', true],
  ])(
    'applies a current-session profile save to the latest user and keeps client and socket%s',
    async (_label, strict) => {
      renderApp(strict);
      await loggedInAs('alice');
      const client = handles.client;
      client.setQueryData(['probe'], 'account-a-cache');
      const sockets = await liveSockets();
      expect(sockets).toHaveLength(1);
      const save = await startProfileSave();

      await settle(() => save.resolve(aliceUpdated));

      expect(handles.auth.user).toEqual({ ...userA, profile: aliceUpdated });
      expect(handles.client).toBe(client);
      expect(client.getQueryData(['probe'])).toBe('account-a-cache');
      expect(openSockets()).toEqual(sockets);
    },
  );

  it('keeps a newer session when a login completes after the session it started in ended', async () => {
    api.getCurrentUser.mockRejectedValue(new Error('anonymous'));
    api.refreshSession.mockRejectedValue(new Error('anonymous'));
    renderApp();
    await waitFor(() => expect(slot('account-slot').getByLabelText('Email')).toBeInTheDocument());

    const slowLogin = deferred<AuthenticatedUser>();
    api.login.mockReturnValueOnce(slowLogin.promise);
    const account = slot('account-slot');
    fireEvent.click(account.getByRole('button', { name: 'Log in' }));
    fireEvent.change(account.getByLabelText('Email'), { target: { value: userA.email } });
    fireEvent.change(account.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.submit(account.getByLabelText('Email').closest('form')!);
    await waitFor(() => expect(api.login).toHaveBeenCalledOnce());

    // A different session wins the race while the first login is still in flight.
    act(() => handles.auth.completeSignIn(userB, handles.auth.generation));
    await loggedInAs('bob');

    await settle(() => slowLogin.resolve(userA));

    expect(handles.auth.user).toEqual(userB);
  });

  it.each([
    ['resolves', (restore: Deferred<AuthenticatedUser>) => restore.resolve(userA)],
    ['fails', (restore: Deferred<AuthenticatedUser>) => restore.reject(new Error('expired'))],
  ])('keeps a newer session when the initial restoration %s late', async (_name, settleRestore) => {
    const restore = deferred<AuthenticatedUser>();
    api.getCurrentUser.mockReturnValue(restore.promise);
    api.refreshSession.mockRejectedValue(new Error('anonymous'));
    renderApp();
    expect(handles.auth.loading).toBe(true);
    const restoringGeneration = handles.auth.generation;

    act(() => handles.auth.completeSignIn(userB, restoringGeneration));
    await loggedInAs('bob');
    const clientOfB = handles.client;

    await settle(() => settleRestore(restore));
    await act(async () => {
      await Promise.resolve();
    });

    expect(handles.auth.user).toEqual(userB);
    expect(handles.auth.loading).toBe(false);
    expect(handles.client).toBe(clientOfB);
    await waitFor(() => expect(openSockets()).toHaveLength(1));
  });

  it('keeps a newer session when a logout completes after the session it ended was replaced', async () => {
    renderApp();
    await loggedInAs('alice');
    const logoutRequest = deferred<void>();
    api.logout.mockReturnValueOnce(logoutRequest.promise);
    fireEvent.click(slot('account-slot').getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());

    // Another tab of the app replaces the session before the first logout answers.
    const generation = handles.auth.generation;
    act(() => {
      handles.auth.completeSignOut(generation);
      handles.auth.completeSignIn(userB, generation + 1);
    });
    await loggedInAs('bob');
    const clientOfB = handles.client;

    await settle(() => logoutRequest.resolve());

    expect(handles.auth.user).toEqual(userB);
    expect(handles.client).toBe(clientOfB);
    await waitFor(() => expect(openSockets()).toHaveLength(1));
  });

  it('gives the same account a fresh client and socket when logout and login land in one render', async () => {
    renderApp();
    await loggedInAs('alice');
    const clientOfFirstSession = handles.client;
    clientOfFirstSession.setQueryData(['probe'], 'first-session');
    const [firstSocket] = await liveSockets();
    const generation = handles.auth.generation;

    act(() => {
      handles.auth.completeSignOut(generation);
      handles.auth.completeSignIn(userA, generation + 1);
    });
    await loggedInAs('alice');

    expect(handles.client).not.toBe(clientOfFirstSession);
    expect(handles.client.getQueryData(['probe'])).toBeUndefined();
    expect(firstSocket?.closed).toBe(true);
    await waitFor(() => expect(openSockets()).toHaveLength(1));
  });
});
