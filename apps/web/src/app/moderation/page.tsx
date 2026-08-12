import { ModerationPage } from '../../features/moderation/moderation-page';
import { AppShell } from '../../features/navigation/app-shell';

export default function ModerationRoute() {
  return (
    <main className="shell productShell">
      <AppShell>
        <ModerationPage />
      </AppShell>
    </main>
  );
}
