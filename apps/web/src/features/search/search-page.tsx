'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
  type SearchRelationshipState,
} from '@instaclone/api-contracts';

import { followProfile, unfollowProfile } from '../../entities/user/api';
import { queryKeys } from '../feed/query-keys';
import { useDebouncedValue } from './use-debounced-value';
import { normalizeSearchQuery, useSearchUsers } from './use-search-users';

const actionLabel = (relationship: SearchRelationshipState, isPrivate: boolean): string => {
  if (relationship === 'following') return 'Unfollow';
  if (relationship === 'requested') return 'Cancel request';
  return isPrivate ? 'Request to follow' : 'Follow';
};

export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [draft, setDraft] = useState({ value: urlQuery, urlAtEdit: urlQuery });
  const input = draft.urlAtEdit === urlQuery ? draft.value : urlQuery;
  const debouncedInput = useDebouncedValue(input, 350);
  const normalizedQuery = normalizeSearchQuery(debouncedInput);
  const results = useSearchUsers(normalizedQuery);
  const client = useQueryClient();
  const relationship = useMutation({
    mutationFn: async (variables: { userId: string; relationship: SearchRelationshipState }) => {
      if (variables.relationship === 'following' || variables.relationship === 'requested') {
        await unfollowProfile(variables.userId);
      } else {
        await followProfile(variables.userId);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.searchUsersRoot }),
        client.invalidateQueries({ queryKey: queryKeys.feed }),
        client.invalidateQueries({ queryKey: queryKeys.explore }),
      ]);
    },
  });

  useEffect(() => {
    const current = normalizeSearchQuery(urlQuery);
    if (normalizedQuery === current) return;
    const next = new URLSearchParams();
    if (normalizedQuery) next.set('q', normalizedQuery);
    router.replace(next.size > 0 ? `/search?${next.toString()}` : '/search');
  }, [normalizedQuery, router, urlQuery]);

  const users = results.data?.pages.flatMap((page) => page.users) ?? [];
  const active = normalizedQuery.length >= MIN_SEARCH_QUERY_LENGTH;

  return (
    <section className="discoveryPage" aria-labelledby="search-title">
      <header className="pageHeader">
        <p className="eyebrow">People discovery</p>
        <h1 id="search-title">Search</h1>
        <p className="muted">Find people by username or display name.</p>
      </header>
      <label className="searchInput" htmlFor="user-search">
        <span className="srOnly">Search people</span>
        <input
          id="user-search"
          type="search"
          value={input}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          placeholder="Search people"
          autoComplete="off"
          onChange={(event) => setDraft({ value: event.target.value, urlAtEdit: urlQuery })}
        />
      </label>

      {!active ? (
        <div className="discoveryState">Enter at least {MIN_SEARCH_QUERY_LENGTH} characters.</div>
      ) : results.isPending ? (
        <div className="discoveryState" aria-busy="true">
          Searching&hellip;
        </div>
      ) : results.isError ? (
        <div className="discoveryState" role="alert">
          <p>Search is unavailable right now.</p>
          <button type="button" onClick={() => void results.refetch()}>
            Try again
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="discoveryState">No people match &ldquo;{normalizedQuery}&rdquo;.</div>
      ) : (
        <ul className="searchResults" aria-label="People">
          {users.map((user) => (
            <li key={user.userId}>
              <Link href={`/profile/${encodeURIComponent(user.username)}`}>
                <span className="profileAvatar" aria-hidden="true">
                  {user.displayName.slice(0, 1).toLocaleUpperCase('en-US')}
                </span>
                <span>
                  <strong>@{user.username}</strong>
                  <small>
                    {user.displayName}
                    {user.isPrivate ? ' · Private' : ''}
                  </small>
                </span>
              </Link>
              {user.relationship !== 'self' ? (
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={relationship.isPending}
                  onClick={() =>
                    relationship.mutate({
                      userId: user.userId,
                      relationship: user.relationship,
                    })
                  }
                >
                  {actionLabel(user.relationship, user.isPrivate)}
                </button>
              ) : (
                <span className="muted">You</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {relationship.isError ? (
        <p className="formError" role="alert">
          The relationship could not be updated.
        </p>
      ) : null}
      {results.hasNextPage ? (
        <button
          className="loadMore"
          type="button"
          disabled={results.isFetchingNextPage}
          onClick={() => void results.fetchNextPage()}
        >
          {results.isFetchingNextPage ? 'Loading&hellip;' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
