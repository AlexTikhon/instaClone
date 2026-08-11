'use client';

import Image from 'next/image';
import Link from 'next/link';

import { useExplore } from './use-explore';

export function ExploreGrid() {
  const explore = useExplore();
  if (explore.isPending) {
    return (
      <section className="discoveryPage" aria-label="Explore" aria-busy="true">
        <header className="pageHeader">
          <p className="eyebrow">Recent and interesting</p>
          <h1>Explore</h1>
        </header>
        <div className="exploreGrid exploreSkeleton" />
      </section>
    );
  }
  if (explore.isError) {
    return (
      <section className="discoveryPage" aria-label="Explore">
        <header className="pageHeader">
          <p className="eyebrow">Recent and interesting</p>
          <h1>Explore</h1>
        </header>
        <div className="discoveryState" role="alert">
          <p>Explore is unavailable right now.</p>
          <button type="button" onClick={() => void explore.refetch()}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  const items = explore.data.pages.flatMap((page) => page.items);
  return (
    <section className="discoveryPage" aria-labelledby="explore-title">
      <header className="pageHeader">
        <p className="eyebrow">Recent and interesting</p>
        <h1 id="explore-title">Explore</h1>
        <p className="muted">Visible posts ranked by engagement and freshness.</p>
      </header>
      {items.length === 0 ? (
        <div className="discoveryState">
          There are no discoverable posts yet. Follow people or check back later.
        </div>
      ) : (
        <div className="exploreGrid">
          {items.map((item) => {
            const media = item.post.media[0];
            return media?.url ? (
              <Link
                key={item.post.id}
                className="exploreTile"
                href={`/profile/${encodeURIComponent(item.post.author.username)}`}
                aria-label={`Post by ${item.post.author.username}: ${item.post.caption || 'image'}`}
              >
                <Image
                  src={media.url}
                  alt={item.post.caption || `Post by ${item.post.author.username}`}
                  width={media.width ?? 640}
                  height={media.height ?? 640}
                  sizes="(max-width: 720px) 33vw, 260px"
                  unoptimized
                />
                <span aria-hidden="true">
                  {item.engagement.likeCount} likes &middot; {item.engagement.commentCount} comments
                </span>
              </Link>
            ) : null;
          })}
        </div>
      )}
      {explore.hasNextPage ? (
        <button
          className="loadMore"
          type="button"
          disabled={explore.isFetchingNextPage}
          onClick={() => void explore.fetchNextPage()}
        >
          {explore.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
