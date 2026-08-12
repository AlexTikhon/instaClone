'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { createConversation } from '../../entities/messaging/api';
import { listPosts } from '../../entities/post/api';
import { findProfile, followProfile, unfollowProfile } from '../../entities/user/api';
import { useAuth } from '../auth/auth-provider';
import { queryKeys } from '../feed/query-keys';
import { normalizeSearchQuery, useSearchUsers } from '../search/use-search-users';

export function ProfilePage({ username }: { username: string }) {
  const normalizedUsername = normalizeSearchQuery(username);
  const { user: viewer } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: queryKeys.profile(normalizedUsername),
    queryFn: () => findProfile(normalizedUsername),
  });
  const relationshipQuery = useSearchUsers(normalizedUsername);
  const relationship = relationshipQuery.data?.pages
    .flatMap((page) => page.users)
    .find((candidate) => candidate.username === normalizedUsername)?.relationship;
  const posts = useInfiniteQuery({
    queryKey: queryKeys.profilePosts(profile.data?.userId ?? 'pending'),
    queryFn: ({ pageParam, signal }) => listPosts(profile.data!.userId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: profile.isSuccess,
  });
  const follow = useMutation({
    mutationFn: async () => {
      if (!profile.data) return;
      if (relationship === 'following' || relationship === 'requested') {
        await unfollowProfile(profile.data.userId);
      } else {
        await followProfile(profile.data.userId);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.searchUsersRoot }),
        client.invalidateQueries({ queryKey: queryKeys.feed }),
        client.invalidateQueries({ queryKey: queryKeys.explore }),
        profile.data
          ? client.invalidateQueries({ queryKey: queryKeys.profilePosts(profile.data.userId) })
          : Promise.resolve(),
      ]);
    },
  });
  const message = useMutation({
    mutationFn: () => createConversation(profile.data!.userId),
    onSuccess: (conversation) => router.push(`/messages/${conversation.id}`),
  });

  if (profile.isPending) return <div className="discoveryState">Loading profile&hellip;</div>;
  if (profile.isError) {
    return (
      <div className="discoveryState" role="alert">
        This profile is unavailable.
      </div>
    );
  }

  const visiblePosts = posts.data?.pages.flatMap((page) => page.posts) ?? [];
  return (
    <section className="discoveryPage" aria-labelledby="profile-page-title">
      <header className="publicProfileHeader">
        <span className="profileAvatar profileAvatarLarge" aria-hidden="true">
          {profile.data.displayName.slice(0, 1).toLocaleUpperCase('en-US')}
        </span>
        <div>
          <p className="eyebrow">{profile.data.isPrivate ? 'Private account' : 'Public profile'}</p>
          <h1 id="profile-page-title">@{profile.data.username}</h1>
          <h2>{profile.data.displayName}</h2>
          {profile.data.bio ? <p>{profile.data.bio}</p> : null}
          {profile.data.websiteUrl ? (
            <a href={profile.data.websiteUrl} rel="noreferrer" target="_blank">
              {profile.data.websiteUrl}
            </a>
          ) : null}
        </div>
        {viewer?.id !== profile.data.userId ? (
          <div className="profileActions">
            <button type="button" disabled={message.isPending} onClick={() => message.mutate()}>
              {message.isPending ? 'Opening…' : 'Message'}
            </button>
            {relationship ? (
              <button
                type="button"
                className="secondaryButton"
                disabled={follow.isPending}
                onClick={() => follow.mutate()}
              >
                {relationship === 'following'
                  ? 'Unfollow'
                  : relationship === 'requested'
                    ? 'Cancel request'
                    : profile.data.isPrivate
                      ? 'Request to follow'
                      : 'Follow'}
              </button>
            ) : null}
            {message.isError ? (
              <span className="formError" role="alert">
                Messaging is unavailable.
              </span>
            ) : null}
          </div>
        ) : null}
      </header>
      {posts.isPending ? (
        <div className="discoveryState" aria-busy="true">
          Loading posts&hellip;
        </div>
      ) : posts.isError ? (
        <div className="discoveryState" role="alert">
          Posts could not be loaded.
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="discoveryState">
          {profile.data.isPrivate && viewer?.id !== profile.data.userId
            ? 'No posts are visible. This account may require an accepted follow.'
            : 'No posts yet.'}
        </div>
      ) : (
        <div className="exploreGrid" aria-label={`Posts by ${profile.data.username}`}>
          {visiblePosts.map((post) => {
            const media = post.media[0];
            return media?.url ? (
              <article className="exploreTile" key={post.id}>
                <Image
                  src={media.url}
                  alt={post.caption || `Post by ${post.author.username}`}
                  width={media.width ?? 640}
                  height={media.height ?? 640}
                  sizes="(max-width: 720px) 33vw, 260px"
                  unoptimized
                />
              </article>
            ) : null;
          })}
        </div>
      )}
      {posts.hasNextPage ? (
        <button
          className="loadMore"
          type="button"
          disabled={posts.isFetchingNextPage}
          onClick={() => void posts.fetchNextPage()}
        >
          {posts.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
