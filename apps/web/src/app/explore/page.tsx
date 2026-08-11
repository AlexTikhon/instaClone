import { ExploreGrid } from '../../features/explore/explore-grid';
import { AppShell } from '../../features/navigation/app-shell';

export default function ExploreRoute() {
  return (
    <main className="shell productShell">
      <AppShell>
        <ExploreGrid />
      </AppShell>
    </main>
  );
}
