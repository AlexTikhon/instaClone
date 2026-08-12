import { AppShell } from '../../features/navigation/app-shell';
import { MessagingPage } from '../../features/messaging/messaging-page';

export default function MessagesRoute() {
  return (
    <main className="shell productShell">
      <AppShell>
        <MessagingPage />
      </AppShell>
    </main>
  );
}
