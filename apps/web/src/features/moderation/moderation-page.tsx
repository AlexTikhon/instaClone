'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { listModerationCases } from '../../entities/moderation/api';
import { useAuth } from '../auth/auth-provider';

export function ModerationPage() {
  const { user } = useAuth();
  const privileged = user?.role === 'MODERATOR' || user?.role === 'ADMIN';
  const cases = useInfiniteQuery({
    queryKey: ['moderation', 'cases'],
    queryFn: ({ pageParam }) => listModerationCases(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: privileged,
  });

  if (!privileged) {
    return (
      <section className="discoveryState" role="alert">
        Moderator access is required.
      </section>
    );
  }
  if (cases.isPending) return <section className="discoveryState">Loading cases…</section>;
  if (cases.isError) {
    return (
      <section className="discoveryState" role="alert">
        Moderation cases could not be loaded.
      </section>
    );
  }
  const rows = cases.data.pages.flatMap((page) => page.cases);
  return (
    <section className="moderationPage" aria-labelledby="moderation-title">
      <header>
        <p className="eyebrow">Trust &amp; Safety</p>
        <h1 id="moderation-title">Moderation cases</h1>
      </header>
      {rows.length === 0 ? <p className="discoveryState">No cases found.</p> : null}
      <ul className="moderationCaseList">
        {rows.map((item) => (
          <li key={item.id}>
            <Link href={`/moderation/${item.id}`}>
              <strong>{item.targetType}</strong>
              <span>{item.status.replace('_', ' ')}</span>
              <span>
                {item.reportCount} report{item.reportCount === 1 ? '' : 's'}
              </span>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
            </Link>
          </li>
        ))}
      </ul>
      {cases.hasNextPage ? (
        <button
          type="button"
          className="loadMore"
          disabled={cases.isFetchingNextPage}
          onClick={() => void cases.fetchNextPage()}
        >
          {cases.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
