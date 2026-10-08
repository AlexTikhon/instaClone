'use client';

import { NotificationsPanel } from './notifications-panel';
import { useNotifications } from './use-notifications';

export function ActivityPage() {
  const notifications = useNotifications();
  return (
    <section className="discoveryPage" aria-labelledby="activity-title">
      <header className="pageHeader">
        <p className="eyebrow">Updates</p>
        <h1 id="activity-title">Notifications</h1>
      </header>
      <NotificationsPanel notifications={notifications} />
    </section>
  );
}
