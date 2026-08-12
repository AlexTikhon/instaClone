import { MessagingPage } from '../../../features/messaging/messaging-page';
import { AppShell } from '../../../features/navigation/app-shell';

export default async function ConversationRoute({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <main className="shell productShell">
      <AppShell>
        <MessagingPage conversationId={conversationId} />
      </AppShell>
    </main>
  );
}
