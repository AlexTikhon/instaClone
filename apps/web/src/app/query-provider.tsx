'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../features/auth/auth-provider';

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });

interface QuerySession {
  /** Authenticated user id, or null while anonymous. Profile edits never change it. */
  viewerId: string | null;
  /** Distinguishes consecutive sessions, e.g. logging out and back in as the same user. */
  generation: number;
  client: QueryClient;
}

/** Aborts what can be aborted and drops every cached query and mutation of a finished session. */
const disposeQueryClient = (client: QueryClient) => {
  void client.cancelQueries();
  client.clear();
};

/**
 * Owns one QueryClient per authentication session. When the authenticated user changes
 * (logout, login, account replacement) the previous client is replaced during render, so
 * the next account's content never reads the previous account's cache. Components under the
 * provider are remounted by `key`, because TanStack observers stay bound to the client they
 * were created with. Late responses and mutation callbacks from the old session settle on
 * the old, unreferenced client and cannot reach the new one.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const [stored, setStored] = useState<QuerySession>(() => ({
    viewerId,
    generation: 0,
    client: createQueryClient(),
  }));

  let session = stored;
  if (stored.viewerId !== viewerId) {
    session = { viewerId, generation: stored.generation + 1, client: createQueryClient() };
    setStored(session);
  }

  // Dispose only after the replacement committed. Comparing against the last mounted client
  // (instead of cleaning up per effect run) keeps StrictMode's simulated unmount from
  // clearing the cache of a session that is still live.
  const mountedClient = useRef(session.client);
  useEffect(() => {
    const previous = mountedClient.current;
    mountedClient.current = session.client;
    if (previous !== session.client) disposeQueryClient(previous);
  }, [session.client]);

  return (
    <QueryClientProvider key={session.generation} client={session.client}>
      {children}
    </QueryClientProvider>
  );
}
