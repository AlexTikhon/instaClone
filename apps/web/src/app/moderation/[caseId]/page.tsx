import { ModerationCasePage } from '../../../features/moderation/moderation-case-page';
import { AppShell } from '../../../features/navigation/app-shell';

export default async function ModerationCaseRoute({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return (
    <main className="shell productShell">
      <AppShell>
        <ModerationCasePage caseId={caseId} />
      </AppShell>
    </main>
  );
}
