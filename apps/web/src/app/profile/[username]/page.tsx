import { AppShell } from '../../../features/navigation/app-shell';
import { ProfilePage } from '../../../features/profile/profile-page';

export default async function ProfileRoute({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <main className="shell productShell">
      <AppShell>
        <ProfilePage username={decodeURIComponent(username)} />
      </AppShell>
    </main>
  );
}
