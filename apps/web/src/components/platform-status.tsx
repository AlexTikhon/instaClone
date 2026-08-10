import type { ApiStatus } from '../lib/platform-api';

export interface PlatformStatusProps {
  apiStatus: ApiStatus;
}

export function PlatformStatus({ apiStatus }: PlatformStatusProps) {
  const online = apiStatus.status === 'ok';

  return (
    <div className="status" role="status">
      <span className={online ? 'statusDot statusDotOnline' : 'statusDot'} aria-hidden="true" />
      API {online ? 'online' : 'not reachable'}
    </div>
  );
}
