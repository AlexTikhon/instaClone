import { AppShell } from '../../features/navigation/app-shell';
import { ActivityPage } from '../../features/notifications/activity-page';

export default function ActivityRoute() {
  return (
    <main className="shell productShell">
      <AppShell>
        <ActivityPage />
      </AppShell>
    </main>
  );
}
