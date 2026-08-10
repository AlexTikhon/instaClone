import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlatformStatus } from './platform-status';

describe('PlatformStatus', () => {
  it('renders the contract-backed API status', () => {
    render(
      <PlatformStatus
        apiStatus={{ status: 'ok', service: 'api', timestamp: new Date().toISOString() }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('API online');
  });

  it('renders an unavailable state without throwing', () => {
    render(<PlatformStatus apiStatus={{ status: 'unavailable' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('API not reachable');
  });
});
