'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

import { getCsrfToken, getCurrentUser, refreshSession } from '../../lib/identity-api';

type Profile = AuthenticatedUser['profile'];

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  /**
   * Identifies the current authentication session. It changes on every sign-in, sign-out and
   * restoration, so it distinguishes "A, logged out, A again" where the user id cannot. Capture
   * it before starting an asynchronous operation and pass it to the `complete*` action.
   */
  generation: number;
  /** Starts a new session as `user`, unless the session `generation` began in has ended. */
  completeSignIn: (user: AuthenticatedUser, generation: number) => void;
  /** Ends the session `generation` began in. Ignored if a newer session already replaced it. */
  completeSignOut: (generation: number) => void;
  /**
   * Patches the profile of the current user when `generation` is still current. It keeps the
   * session, so the query client and realtime socket survive.
   */
  completeProfileUpdate: (profile: Profile, generation: number) => void;
}

interface AuthState {
  user: AuthenticatedUser | null;
  loading: boolean;
  generation: number;
}

type AuthAction =
  | { type: 'signedIn'; user: AuthenticatedUser; generation: number }
  | { type: 'signedOut'; generation: number }
  | { type: 'profileUpdated'; profile: Profile; generation: number }
  | { type: 'restored'; user: AuthenticatedUser | null; generation: number };

/**
 * Every transition checks the action's generation against the state it is applied to, so the
 * check and the write cannot be separated by another update. Obsolete completions are no-ops.
 */
const reduce = (state: AuthState, action: AuthAction): AuthState => {
  if (action.generation !== state.generation) return state;
  switch (action.type) {
    case 'signedIn':
      return { user: action.user, loading: false, generation: state.generation + 1 };
    case 'signedOut':
      return { user: null, loading: false, generation: state.generation + 1 };
    case 'profileUpdated':
      return state.user ? { ...state, user: { ...state.user, profile: action.profile } } : state;
    case 'restored':
      return action.user
        ? { user: action.user, loading: false, generation: state.generation + 1 }
        : { ...state, loading: false };
  }
};

const initialState: AuthState = { user: null, loading: true, generation: 0 };

const AuthContext = createContext<AuthContextValue | null>(null);

const actionsOf = (dispatch: Dispatch<AuthAction>) => ({
  completeSignIn: (user: AuthenticatedUser, generation: number) =>
    dispatch({ type: 'signedIn', user, generation }),
  completeSignOut: (generation: number) => dispatch({ type: 'signedOut', generation }),
  completeProfileUpdate: (profile: Profile, generation: number) =>
    dispatch({ type: 'profileUpdated', profile, generation }),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);

  useEffect(() => {
    let active = true;
    // Restoration belongs to the first session; a sign-in that wins the race supersedes it.
    const generation = initialState.generation;
    const restore = async () => {
      let current: AuthenticatedUser | null = null;
      try {
        current = await getCurrentUser();
      } catch {
        try {
          current = await refreshSession(await getCsrfToken());
        } catch {
          // Anonymous visitors are expected; authentication UI owns the next action.
        }
      }
      if (active) dispatch({ type: 'restored', user: current, generation });
    };
    void restore();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      loading: state.loading,
      generation: state.generation,
      ...actionsOf(dispatch),
    }),
    [state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
