'use client';

import { IdentityPanel } from '../../components/identity-panel';
import { HomeFeed } from '../feed/home-feed';
import { AppShell } from './app-shell';

export function HomeApplication() {
  return (
    <AppShell>
      <div className="authenticatedApp">
        <IdentityPanel />
        <div className="activityColumn">
          <HomeFeed />
        </div>
      </div>
    </AppShell>
  );
}
