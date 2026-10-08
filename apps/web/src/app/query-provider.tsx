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
  /** The authentication generation this client belongs to. Profile edits never change it. */
  generation: number;
  client: QueryClient;
}

/** Aborts what can be aborted and drops every cached query and mutation of a finished session. */
const disposeQueryClient = (client: QueryClient) => {
  void client.cancelQueries();
  client.clear();
};

/**
 * Owns one QueryClient per authentication session, identified by the authentication generation
 * rather than the user id: logging out and back in as the same account, even when both
 * transitions land in one render, is a new session with a fresh client. The previous client is
 * replaced during render, so the next session never reads its cache. Components under the
 * provider are remounted by `key`, because TanStack observers stay bound to the client they
 * were created with. Late responses and mutation callbacks from the old session settle on
 * the old, unreferenced client and cannot reach the new one.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { generation } = useAuth();
  const [stored, setStored] = useState<QuerySession>(() => ({
    generation,
    client: createQueryClient(),
  }));

  let session = stored;
  if (stored.generation !== generation) {
    session = { generation, client: createQueryClient() };
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
