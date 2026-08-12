'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { IdentityPanel } from '../../components/identity-panel';
import { useAuth } from '../auth/auth-provider';
import { useApplicationRealtime } from '../realtime/use-application-realtime';

const links = [
  { href: '/', label: 'Home', match: (path: string) => path === '/' },
  { href: '/search', label: 'Search', match: (path: string) => path === '/search' },
  { href: '/explore', label: 'Explore', match: (path: string) => path === '/explore' },
  { href: '/messages', label: 'Messages', match: (path: string) => path.startsWith('/messages') },
  { href: '/activity', label: 'Notifications', match: (path: string) => path === '/activity' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  useApplicationRealtime(Boolean(user));
  if (loading) return <div className="identityCard">Restoring session&hellip;</div>;
  if (!user) return <IdentityPanel />;

  return (
    <div className="productApp">
      <nav className="primaryNavigation" aria-label="Application">
        <Link className="brandLink" href="/">
          InstaClone
        </Link>
        <div>
          {links.map((link) => (
            <Link
              key={link.href}
              className={link.match(pathname) ? 'active' : undefined}
              href={link.href}
            >
              {link.label}
            </Link>
          ))}
          <Link
            className={pathname.startsWith('/profile/') ? 'active' : undefined}
            href={`/profile/${encodeURIComponent(user.profile.username)}`}
          >
            Profile
          </Link>
          {user.role === 'MODERATOR' || user.role === 'ADMIN' ? (
            <Link
              className={pathname.startsWith('/moderation') ? 'active' : undefined}
              href="/moderation"
            >
              Moderation
            </Link>
          ) : null}
        </div>
      </nav>
      <div className="productContent">{children}</div>
    </div>
  );
}
