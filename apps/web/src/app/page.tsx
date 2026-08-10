import { PlatformStatus } from '../components/platform-status';
import { getApiLiveness } from '../lib/platform-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiStatus = await getApiLiveness();

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Engineering foundation · Phase 0</p>
        <h1 id="page-title">Built to make the hard parts visible.</h1>
        <p className="lede">
          A clean modular-monolith foundation for learning production architecture before product
          complexity arrives.
        </p>
        <PlatformStatus apiStatus={apiStatus} />
      </section>

      <section className="principles" aria-label="Foundation principles">
        <article>
          <span>01</span>
          <h2>Explicit boundaries</h2>
          <p>HTTP, persistence, queues, and object storage begin behind clear ownership seams.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Operational truth</h2>
          <p>Structured logs, request IDs, liveness, and readiness are present from the start.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Measured evolution</h2>
          <p>Product domains and scale patterns arrive only when a concrete phase needs them.</p>
        </article>
      </section>
    </main>
  );
}
