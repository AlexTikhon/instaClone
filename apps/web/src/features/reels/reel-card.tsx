'use client';

import { useState } from 'react';

import type { ReelResponse } from '@instaclone/api-contracts';

import { useAuth } from '../auth/auth-provider';
import { ReportDialog } from '../moderation/report-dialog';
import { ReelPlayer } from './reel-player';

export function ReelCard({
  reel,
  active,
  elementRef,
}: {
  reel: ReelResponse;
  active: boolean;
  elementRef?: (element: HTMLElement | null) => void;
}) {
  const [showReport, setShowReport] = useState(false);
  const { user } = useAuth();
  return (
    <article ref={elementRef} className="reelCard" data-reel-id={reel.id}>
      <ReelPlayer
        playback={reel.playback}
        active={active}
        label={reel.caption || `Reel by ${reel.author.username}`}
      />
      <div className="reelOverlay">
        <strong>@{reel.author.username}</strong>
        {reel.caption ? <p>{reel.caption}</p> : null}
        {user?.id !== reel.author.userId ? (
          <button type="button" className="secondaryButton" onClick={() => setShowReport(true)}>
            Report
          </button>
        ) : null}
      </div>
      {showReport ? (
        <ReportDialog
          targetType="REEL"
          targetId={reel.id}
          targetLabel="Reel"
          onClose={() => setShowReport(false)}
        />
      ) : null}
    </article>
  );
}
