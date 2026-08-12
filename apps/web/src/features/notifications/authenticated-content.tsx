'use client';

import { useState } from 'react';

import { HomeFeed } from '../feed/home-feed';
import { NotificationsPanel } from './notifications-panel';
import { useNotifications } from './use-notifications';

export function AuthenticatedContent() {
  const [view, setView] = useState<'home' | 'notifications'>('home');
  const notifications = useNotifications();
  const unreadCount = notifications.data?.pages[0]?.unreadCount ?? 0;
  return (
    <div className="activityColumn">
      <nav className="appNavigation" aria-label="Application">
        <button
          type="button"
          className={view === 'home' ? 'activeAction' : 'secondaryButton'}
          onClick={() => setView('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={view === 'notifications' ? 'activeAction' : 'secondaryButton'}
          onClick={() => setView('notifications')}
        >
          Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </nav>
      {view === 'home' ? <HomeFeed /> : <NotificationsPanel notifications={notifications} />}
    </div>
  );
}
