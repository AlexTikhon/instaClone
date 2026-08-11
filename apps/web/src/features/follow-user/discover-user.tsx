'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import type { Profile } from '@instaclone/api-contracts';

import { findProfile, followProfile } from '../../entities/user/api';
import { queryKeys } from '../feed/query-keys';

export function DiscoverUser({ emailVerified }: { emailVerified: boolean }) {
  const client = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const lookup = useMutation({ mutationFn: findProfile, onSuccess: setProfile });
  const follow = useMutation({
    mutationFn: followProfile,
    onSuccess: async (result) => {
      setMessage(
        result.state === 'following'
          ? 'Following. Their posts can now appear in Home.'
          : 'Follow request sent.',
      );
      await client.invalidateQueries({ queryKey: queryKeys.feed });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const value = new FormData(event.currentTarget).get('username');
    if (typeof value === 'string' && value.trim()) lookup.mutate(value);
  };
  return (
    <section className="discoverUser" aria-labelledby="discover-title">
      <h2 id="discover-title">Find a profile</h2>
      <form className="commentForm" onSubmit={submit}>
        <label className="srOnly" htmlFor="discover-username">
          Username
        </label>
        <input id="discover-username" name="username" placeholder="username" required />
        <button type="submit" disabled={lookup.isPending}>
          Find
        </button>
      </form>
      {lookup.isError ? <p className="formError">That public profile was not found.</p> : null}
      {profile ? (
        <div className="profileResult">
          <p>
            <strong>@{profile.username}</strong>
            <br />
            <span className="muted">{profile.displayName}</span>
          </p>
          <button
            type="button"
            className="secondaryButton"
            disabled={!emailVerified || follow.isPending}
            onClick={() => follow.mutate(profile.userId)}
          >
            {profile.isPrivate ? 'Request to follow' : 'Follow'}
          </button>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
