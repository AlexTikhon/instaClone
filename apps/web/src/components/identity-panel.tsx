'use client';

import { useEffect, useState, type FormEvent } from 'react';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

import {
  getCsrfToken,
  getCurrentUser,
  login,
  logout,
  refreshSession,
  register,
  updateOwnProfile,
} from '../lib/identity-api';
import { CreatePostForm } from '../features/create-post/create-post-form';
import { AuthenticatedContent } from '../features/notifications/authenticated-content';
import { DiscoverUser } from '../features/follow-user/discover-user';
import { CreateStoryForm } from '../features/create-story/create-story-form';

type Mode = 'login' | 'register';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

const formString = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

export function IdentityPanel() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [mode, setMode] = useState<Mode>('register');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const current = await getCurrentUser();
        if (active) setUser(current);
      } catch {
        try {
          const csrfToken = await getCsrfToken();
          const current = await refreshSession(csrfToken);
          if (active) setUser(current);
        } catch {
          // A visitor without a session should see the auth form, not an error state.
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, []);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const csrfToken = await getCsrfToken();
      const current =
        mode === 'register'
          ? await register(
              {
                email: formString(data, 'email'),
                password: formString(data, 'password'),
                username: formString(data, 'username'),
                displayName: formString(data, 'displayName'),
              },
              csrfToken,
            )
          : await login(
              { email: formString(data, 'email'), password: formString(data, 'password') },
              csrfToken,
            );
      setUser(current);
    } catch (submissionError) {
      setError(messageOf(submissionError));
    } finally {
      setPending(false);
    }
  };

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const csrfToken = await getCsrfToken();
      const profile = await updateOwnProfile(
        {
          displayName: formString(data, 'displayName'),
          bio: formString(data, 'bio'),
          websiteUrl: formString(data, 'websiteUrl'),
          isPrivate: data.get('isPrivate') === 'on',
        },
        csrfToken,
      );
      setUser({ ...user, profile });
    } catch (submissionError) {
      setError(messageOf(submissionError));
    } finally {
      setPending(false);
    }
  };

  const endSession = async () => {
    setPending(true);
    setError(null);
    try {
      await logout(await getCsrfToken());
      setUser(null);
    } catch (logoutError) {
      setError(messageOf(logoutError));
    } finally {
      setPending(false);
    }
  };

  if (loading) return <div className="identityCard">Restoring session…</div>;

  if (user) {
    return (
      <div className="authenticatedApp">
        <section className="identityCard" aria-labelledby="profile-title">
          <div className="identityHeader">
            <div>
              <p className="eyebrow">Authenticated profile</p>
              <h2 id="profile-title">@{user.profile.username}</h2>
            </div>
            <button
              className="secondaryButton"
              type="button"
              disabled={pending}
              onClick={() => void endSession()}
            >
              Log out
            </button>
          </div>
          <form className="identityForm" onSubmit={(event) => void submitProfile(event)}>
            <label>
              Display name
              <input
                name="displayName"
                defaultValue={user.profile.displayName}
                required
                maxLength={60}
              />
            </label>
            <label>
              Bio
              <textarea name="bio" defaultValue={user.profile.bio} maxLength={160} rows={3} />
            </label>
            <label>
              Website
              <input name="websiteUrl" defaultValue={user.profile.websiteUrl ?? ''} type="url" />
            </label>
            <label className="checkLabel">
              <input name="isPrivate" type="checkbox" defaultChecked={user.profile.isPrivate} />
              Private account
            </label>
            {error && <p className="formError">{error}</p>}
            <button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save profile'}
            </button>
          </form>
          <CreatePostForm emailVerified={user.emailVerified} />
          <CreateStoryForm emailVerified={user.emailVerified} />
          <DiscoverUser emailVerified={user.emailVerified} />
        </section>
        <AuthenticatedContent />
      </div>
    );
  }

  return (
    <section className="identityCard" aria-labelledby="auth-title">
      <div className="modeSwitch" aria-label="Authentication mode">
        <button
          type="button"
          className={mode === 'register' ? 'active' : ''}
          onClick={() => setMode('register')}
        >
          Register
        </button>
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => setMode('login')}
        >
          Log in
        </button>
      </div>
      <h2 id="auth-title">{mode === 'register' ? 'Create your profile' : 'Welcome back'}</h2>
      <form className="identityForm" onSubmit={(event) => void submitAuth(event)}>
        {mode === 'register' && (
          <>
            <label>
              Username
              <input name="username" required minLength={3} maxLength={30} />
            </label>
            <label>
              Display name
              <input name="displayName" required maxLength={60} />
            </label>
          </>
        )}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 12 : 1}
          />
        </label>
        {error && <p className="formError">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? 'Working…' : mode === 'register' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </section>
  );
}
