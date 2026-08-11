import { PlatformStatus } from '../components/platform-status';
import { HomeApplication } from '../features/navigation/home-application';
import { getApiLiveness } from '../lib/platform-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiStatus = await getApiLiveness();

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Discovery &middot; Phase 7</p>
        <h1 id="page-title">Share, discover, and return to what matters.</h1>
        <p className="lede">
          A chronological home feed, 24-hour Stories, and privacy-safe discovery built on explicit
          social visibility rules.
        </p>
        <PlatformStatus apiStatus={apiStatus} />
      </section>

      <HomeApplication />

      <section className="principles" aria-label="Engineering principles">
        <article>
          <span>01</span>
          <h2>PostgreSQL discovery</h2>
          <p>Bounded, indexed relevance keeps search simple until scale demands extraction.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Shared visibility</h2>
          <p>Search, Explore, posts, and Home enforce the same private-account and block policy.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Stable pagination</h2>
          <p>Opaque keyset cursors bind discovery pages to deterministic ordering snapshots.</p>
        </article>
      </section>
    </main>
  );
}
