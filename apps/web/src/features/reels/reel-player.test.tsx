import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReelPlayer, selectHlsPlaybackMode } from './reel-player';

const playback = {
  type: 'HLS' as const,
  url: '/api/v1/reels/00000000-0000-4000-8000-000000000001/playback/master.m3u8',
  posterUrl: '/api/v1/reels/00000000-0000-4000-8000-000000000001/poster.webp',
  width: 720,
  height: 1280,
  durationMs: 2_000,
};

describe('ReelPlayer', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  it('prefers native HLS, falls back to hls.js, and rejects unsupported playback', () => {
    expect(selectHlsPlaybackMode('probably', true)).toBe('NATIVE');
    expect(selectHlsPlaybackMode('', true)).toBe('HLS_JS');
    expect(selectHlsPlaybackMode('', false)).toBe('UNSUPPORTED');
  });

  it('uses native HLS when available, plays only while active, and cleans up', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const view = render(<ReelPlayer playback={playback} active={false} label="A Reel" />);
    const video = view.getByLabelText('A Reel') as HTMLVideoElement;
    expect(video.src).toContain('/api/v1/reels/');
    expect(pause).toHaveBeenCalled();
    view.rerender(<ReelPlayer playback={playback} active label="A Reel" />);
    expect(play).toHaveBeenCalled();
    view.unmount();
    expect(video.getAttribute('src')).toBeNull();
    expect(load).toHaveBeenCalled();
  });
});
