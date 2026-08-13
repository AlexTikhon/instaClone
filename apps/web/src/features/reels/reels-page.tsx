'use client';

import { useAuth } from '../auth/auth-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CreateReelForm } from './create-reel-form';
import { ReelCard } from './reel-card';
import { useReels } from './use-reels';

export function ReelsPage() {
  const { user } = useAuth();
  const query = useReels();
  const reels = query.data?.pages.flatMap((page) => page.reels) ?? [];
  const elements = useRef(new Map<string, HTMLElement>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);
  useEffect(() => {
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.reelId;
          if (id) ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        const best = [...ratios.entries()]
          .filter(([, ratio]) => ratio >= 0.7)
          .sort((left, right) => right[1] - left[1])[0];
        setActiveId(best?.[0] ?? null);
      },
      { threshold: [0, 0.7, 0.85, 1] },
    );
    for (const element of elements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [reels.length]);
  return (
    <div className="reelsPage">
      <CreateReelForm emailVerified={Boolean(user?.emailVerified)} />
      {query.isPending ? <p role="status">Loading Reels…</p> : null}
      {query.isError ? <p role="alert">Reels are unavailable.</p> : null}
      {!query.isPending && !query.isError && reels.length === 0 ? (
        <p>No visible Reels yet.</p>
      ) : null}
      <section className="reelsFeed" aria-label="Reels feed">
        {reels.map((reel) => (
          <ReelCard
            key={reel.id}
            reel={reel}
            active={activeId === reel.id}
            elementRef={(element) => register(reel.id, element)}
          />
        ))}
      </section>
      {query.hasNextPage ? (
        <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
