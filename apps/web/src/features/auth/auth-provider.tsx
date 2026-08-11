'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AuthenticatedUser } from '@instaclone/api-contracts';

import { getCsrfToken, getCurrentUser, refreshSession } from '../../lib/identity-api';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  setUser: (user: AuthenticatedUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const current = await getCurrentUser();
        if (active) setUser(current);
      } catch {
        try {
          const current = await refreshSession(await getCsrfToken());
          if (active) setUser(current);
        } catch {
          // Anonymous visitors are expected; authentication UI owns the next action.
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

  const value = useMemo(() => ({ user, loading, setUser }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
