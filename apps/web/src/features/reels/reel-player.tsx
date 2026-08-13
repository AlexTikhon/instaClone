'use client';

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

import type { VideoPlayback } from '@instaclone/api-contracts';

import { apiBaseUrl } from '../../shared/api/http-client';

export const selectHlsPlaybackMode = (
  nativeHlsSupport: string,
  mediaSourceSupport: boolean,
): 'NATIVE' | 'HLS_JS' | 'UNSUPPORTED' => {
  if (nativeHlsSupport) return 'NATIVE';
  if (mediaSourceSupport) return 'HLS_JS';
  return 'UNSUPPORTED';
};

export function ReelPlayer({
  playback,
  active,
  label,
}: {
  playback: VideoPlayback;
  active: boolean;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === playback.url;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const playbackUrl = new URL(playback.url, apiBaseUrl).toString();
    let hls: Hls | null = null;
    const mode = selectHlsPlaybackMode(
      video.canPlayType('application/vnd.apple.mpegurl'),
      Hls.isSupported(),
    );
    if (mode === 'NATIVE') {
      video.src = playbackUrl;
    } else if (mode === 'HLS_JS') {
      hls = new Hls({
        autoStartLoad: false,
        maxBufferLength: 12,
        maxMaxBufferLength: 30,
        xhrSetup: (request) => {
          request.withCredentials = true;
        },
      });
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else {
          setFailedUrl(playback.url);
          hls?.destroy();
          hls = null;
        }
      });
    } else {
      queueMicrotask(() => setFailedUrl(playback.url));
    }
    return () => {
      hls?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [playback.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (active) {
      hlsRef.current?.startLoad();
      void video.play().catch(() => undefined);
    } else video.pause();
  }, [active, failed]);

  if (failed) {
    return (
      <div className="reelPlaybackError" role="alert">
        This Reel could not be played.
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      className="reelVideo"
      aria-label={label}
      poster={new URL(playback.posterUrl, apiBaseUrl).toString()}
      crossOrigin="use-credentials"
      playsInline
      muted
      loop
      controls
      preload={active ? 'metadata' : 'none'}
      onError={() => setFailedUrl(playback.url)}
    >
      Your browser does not support HLS video playback.
    </video>
  );
}
