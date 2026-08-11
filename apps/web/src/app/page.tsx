import { IdentityPanel } from '../components/identity-panel';
import { PlatformStatus } from '../components/platform-status';
import { getApiLiveness } from '../lib/platform-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const apiStatus = await getApiLiveness();

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Stories · Phase 6</p>
        <h1 id="page-title">Share, respond, and return to what matters.</h1>
        <p className="lede">
          A chronological home feed with durable activity and 24-hour Stories, built on secure
          direct uploads and explicit social visibility rules.
        </p>
        <PlatformStatus apiStatus={apiStatus} />
      </section>

      <IdentityPanel />

      <section className="principles" aria-label="Identity principles">
        <article>
          <span>01</span>
          <h2>Memory-hard credentials</h2>
          <p>Passwords are Argon2id hashes and never cross the credential boundary again.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Rotating sessions</h2>
          <p>One-time refresh tokens make replay visible and revoke the affected session.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Owned profile writes</h2>
          <p>The API derives profile ownership from verified session state, never request data.</p>
        </article>
      </section>
    </main>
  );
}
