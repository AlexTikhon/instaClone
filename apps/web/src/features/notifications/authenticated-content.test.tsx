import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedContent } from './authenticated-content';

const hooks = vi.hoisted(() => ({ notifications: vi.fn() }));
vi.mock('./use-notifications', () => ({ useNotifications: hooks.notifications }));
vi.mock('../feed/home-feed', () => ({ HomeFeed: () => <div>Home feed body</div> }));
vi.mock('./notifications-panel', () => ({
  NotificationsPanel: () => <div>Notifications body</div>,
}));

describe('AuthenticatedContent', () => {
  it('shows the unread badge and switches between Home and Notifications', () => {
    hooks.notifications.mockReturnValue({ data: { pages: [{ unreadCount: 3 }] } });
    render(<AuthenticatedContent />);
    expect(screen.getByRole('button', { name: 'Notifications (3)' })).toBeInTheDocument();
    expect(screen.getByText('Home feed body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (3)' }));
    expect(screen.getByText('Notifications body')).toBeInTheDocument();
  });
});
