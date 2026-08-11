import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSearchUsers } from './use-search-users';

const api = vi.hoisted(() => ({ searchUsers: vi.fn() }));
vi.mock('../../entities/search/api', () => ({ searchUsers: api.searchUsers }));

describe('useSearchUsers', () => {
  it('activates only at the minimum normalized query length', async () => {
    api.searchUsers.mockResolvedValue({ users: [], nextCursor: null, hasMore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(({ query }) => useSearchUsers(query), {
      wrapper,
      initialProps: { query: 'a' },
    });
    expect(api.searchUsers).not.toHaveBeenCalled();
    rerender({ query: 'al' });
    await waitFor(() => expect(api.searchUsers).toHaveBeenCalledOnce());
  });
});
