import { Suspense } from 'react';

import { AppShell } from '../../features/navigation/app-shell';
import { SearchPage } from '../../features/search/search-page';

export default function SearchRoute() {
  return (
    <main className="shell productShell">
      <AppShell>
        <Suspense fallback={<div className="discoveryState">Loading search&hellip;</div>}>
          <SearchPage />
        </Suspense>
      </AppShell>
    </main>
  );
}
