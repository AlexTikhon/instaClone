'use client';

import { PostCard } from './post-card';
import { useFeed } from './use-feed';
import { StoryTray } from '../stories/story-tray';

export function HomeFeed() {
  const feed = useFeed();
  if (feed.isPending) {
    return (
      <>
        <StoryTray />
        <section className="feed" aria-label="Home feed" aria-busy="true">
          <div className="feedSkeleton" />
          <div className="feedSkeleton" />
        </section>
      </>
    );
  }
  if (feed.isError) {
    return (
      <section className="feedState" role="alert">
        <h2>Feed unavailable</h2>
        <p>Your posts are safe. Try loading the feed again.</p>
        <button type="button" onClick={() => void feed.refetch()}>
          Try again
        </button>
      </section>
    );
  }
  const items = feed.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <>
        <StoryTray />
        <section className="feedState">
          <h2>Your feed is empty.</h2>
          <p>Create your first post or follow a public profile to see their posts here.</p>
        </section>
      </>
    );
  }
  return (
    <>
      <StoryTray />
      <section className="feed" aria-label="Home feed">
        {items.map((item) => (
          <PostCard key={item.post.id} item={item} />
        ))}
        {feed.hasNextPage ? (
          <button
            type="button"
            className="loadMore"
            disabled={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </section>
    </>
  );
}
