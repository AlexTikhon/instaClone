import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './styles.css';
import { QueryProvider } from './query-provider';
import { AuthProvider } from '../features/auth/auth-provider';

export const metadata: Metadata = {
  title: 'InstaClone Engineering Lab',
  description: 'A production-engineering educational social application.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
