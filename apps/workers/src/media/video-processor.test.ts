import { describe, expect, it } from 'vitest';

import {
  buildHlsArguments,
  PermanentVideoError,
  parseProbeOutput,
  selectVideoRenditions,
} from './video-processor';

const probeJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1080,
        height: 1920,
        avg_frame_rate: '30/1',
        ...overrides,
      },
    ],
    format: { duration: '12.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  });

describe('video processing configuration', () => {
  it('parses bounded metadata and normalizes rotated display dimensions', () => {
    expect(parseProbeOutput(probeJson())).toMatchObject({
      videoCodec: 'h264',
      durationMs: 12_500,
      width: 1080,
      height: 1920,
      frameRate: 30,
      rotationDegrees: 0,
      hasAudio: false,
    });
    expect(
      parseProbeOutput(
        probeJson({ width: 1920, height: 1080, side_data_list: [{ rotation: 90 }] }),
      ),
    ).toMatchObject({ width: 1080, height: 1920, rotationDegrees: 90 });
  });

  it('rejects missing video, excessive duration, codecs, and stream layouts deterministically', () => {
    expect(() =>
      parseProbeOutput(
        JSON.stringify({ streams: [], format: { duration: '1', format_name: 'mov,mp4' } }),
      ),
    ).toThrowError(PermanentVideoError);
    expect(() => parseProbeOutput(probeJson({ codec_name: 'theora' }))).toThrowError(
      expect.objectContaining({ failureCode: 'UNSUPPORTED_VIDEO_CODEC' }),
    );
    const ordinaryVideoStream = {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1080,
      height: 1920,
      avg_frame_rate: '30/1',
    };
    expect(() =>
      parseProbeOutput(
        JSON.stringify({
          streams: [ordinaryVideoStream],
          format: { duration: '91', format_name: 'mov,mp4' },
        }),
      ),
    ).toThrowError(expect.objectContaining({ failureCode: 'VIDEO_TOO_LONG' }));
  });

  it('selects a no-upscale ladder and builds aligned, shell-free HLS arguments', () => {
    expect(selectVideoRenditions({ width: 360, height: 640 })).toEqual([
      { label: '360', bitrateKbps: 700, width: 360, height: 640 },
    ]);
    const probe = parseProbeOutput(probeJson());
    const renditions = selectVideoRenditions(probe);
    expect(renditions.map((item) => item.label)).toEqual(['360', '720', '1080']);
    const args = buildHlsArguments('C:/safe/source', 'C:/safe/output', probe, renditions);
    expect(args).toContain('expr:gte(t,n_forced*4)');
    expect(args).toContain('independent_segments');
    expect(args.join(' ')).not.toContain('sh -c');
    expect(args.join(' ')).not.toContain('cmd /c');
  });
});
