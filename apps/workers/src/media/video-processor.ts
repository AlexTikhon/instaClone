import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { MAX_VIDEO_DURATION_SECONDS } from '@instaclone/api-contracts';

export const VIDEO_PROCESSING_VERSION = 1;
export const HLS_SEGMENT_SECONDS = 4;
const PROCESS_OUTPUT_LIMIT_BYTES = 32 * 1024;
const MIN_VIDEO_DIMENSION = 240;
const MAX_VIDEO_DIMENSION = 4_096;
const SUPPORTED_VIDEO_CODECS = new Set(['h264', 'hevc', 'mpeg4', 'vp8', 'vp9']);
const SUPPORTED_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'pcm_s16le', 'pcm_s24le']);

const probeStreamSchema = z.object({
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  side_data_list: z.array(z.object({ rotation: z.number().optional() }).passthrough()).optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).passthrough().optional(),
});

const probeSchema = z.object({
  streams: z.array(probeStreamSchema),
  format: z.object({
    duration: z.string().optional(),
    format_name: z.string().optional(),
  }),
});

export class PermanentVideoError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
  }
}

export class VideoProcessTimeoutError extends Error {}
export class VideoProcessLaunchError extends Error {}

export interface VideoProbe {
  videoCodec: string;
  audioCodec: string | null;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  hasAudio: boolean;
}

export interface VideoRendition {
  label: '360' | '720' | '1080';
  width: number;
  height: number;
  bitrateKbps: number;
}

export interface ProcessedVideo {
  probe: VideoProbe;
  renditions: VideoRendition[];
  posterWidth: number;
  posterHeight: number;
}

interface ProcessOptions {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export const normalizeRotation = (value: number): 0 | 90 | 180 | 270 => {
  const normalized = ((Math.round(value) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
};

const parseRate = (value: string | undefined): number => {
  if (!value) return 0;
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? '1');
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
};

export const parseProbeOutput = (input: string): VideoProbe => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input);
  } catch {
    throw new PermanentVideoError('INVALID_MEDIA', 'ffprobe did not return valid JSON');
  }
  const parsed = probeSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new PermanentVideoError('INVALID_MEDIA', 'ffprobe metadata was incomplete');
  }
  const videoStreams = parsed.data.streams.filter(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  const audioStreams = parsed.data.streams.filter((stream) => stream.codec_type === 'audio');
  if (videoStreams.length !== 1 || audioStreams.length > 1) {
    throw new PermanentVideoError(
      videoStreams.length === 0 ? 'INVALID_MEDIA' : 'UNSUPPORTED_STREAM_LAYOUT',
      'V1 requires exactly one video stream and at most one audio stream',
    );
  }
  const video = videoStreams[0]!;
  if (!video.codec_name || !SUPPORTED_VIDEO_CODECS.has(video.codec_name)) {
    throw new PermanentVideoError('UNSUPPORTED_VIDEO_CODEC', 'Source video codec is unsupported');
  }
  const audio = audioStreams[0];
  if (audio?.codec_name && !SUPPORTED_AUDIO_CODECS.has(audio.codec_name)) {
    throw new PermanentVideoError('UNSUPPORTED_AUDIO_CODEC', 'Source audio codec is unsupported');
  }
  if (
    !parsed.data.format.format_name?.split(',').some((name) => name === 'mov' || name === 'mp4')
  ) {
    throw new PermanentVideoError('UNSUPPORTED_CONTAINER', 'Source container is unsupported');
  }
  const durationSeconds = Number(parsed.data.format.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new PermanentVideoError('INVALID_MEDIA', 'Video duration is invalid');
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS + 0.05) {
    throw new PermanentVideoError('VIDEO_TOO_LONG', 'Video exceeds the V1 duration limit');
  }
  if (!video.width || !video.height) {
    throw new PermanentVideoError('INVALID_MEDIA', 'Video dimensions are missing');
  }
  const sideRotation = video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation;
  const tagRotation = Number(video.tags?.rotate);
  const rotationDegrees = normalizeRotation(
    sideRotation ?? (Number.isFinite(tagRotation) ? tagRotation : 0),
  );
  const rotated = rotationDegrees === 90 || rotationDegrees === 270;
  const width = rotated ? video.height : video.width;
  const height = rotated ? video.width : video.height;
  if (
    width < MIN_VIDEO_DIMENSION ||
    height < MIN_VIDEO_DIMENSION ||
    width > MAX_VIDEO_DIMENSION ||
    height > MAX_VIDEO_DIMENSION
  ) {
    throw new PermanentVideoError('VIDEO_DIMENSIONS_INVALID', 'Video dimensions are unsupported');
  }
  const frameRate = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120) {
    throw new PermanentVideoError('VIDEO_FRAME_RATE_INVALID', 'Video frame rate is unsupported');
  }
  return {
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    durationMs: Math.round(durationSeconds * 1_000),
    width,
    height,
    frameRate,
    rotationDegrees,
    hasAudio: Boolean(audio),
  };
};

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);

const fitWithin = (
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } => {
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return { width: even(sourceWidth * scale), height: even(sourceHeight * scale) };
};

export const selectVideoRenditions = (
  probe: Pick<VideoProbe, 'width' | 'height'>,
): VideoRendition[] => {
  const portrait = probe.height >= probe.width;
  const ladder = [
    { label: '360' as const, short: 360, long: 640, bitrateKbps: 700 },
    { label: '720' as const, short: 720, long: 1_280, bitrateKbps: 2_500 },
    { label: '1080' as const, short: 1_080, long: 1_920, bitrateKbps: 5_000 },
  ];
  const seen = new Set<string>();
  return ladder.flatMap((target) => {
    const dimensions = fitWithin(
      probe.width,
      probe.height,
      portrait ? target.short : target.long,
      portrait ? target.long : target.short,
    );
    const identity = `${dimensions.width}x${dimensions.height}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [
      {
        label: target.label,
        bitrateKbps: target.bitrateKbps,
        ...dimensions,
      },
    ];
  });
};

export const buildHlsArguments = (
  inputPath: string,
  outputDirectory: string,
  probe: VideoProbe,
  renditions: VideoRendition[],
): string[] => {
  const splitOutputs = renditions.map((_, index) => `[split${index}]`).join('');
  const filters = [`[0:v:0]split=${renditions.length}${splitOutputs}`];
  renditions.forEach((rendition, index) => {
    filters.push(
      `[split${index}]scale=${rendition.width}:${rendition.height}:flags=lanczos,setsar=1[v${index}]`,
    );
  });
  const args = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'warning',
    '-autorotate',
    '-i',
    inputPath,
    '-filter_complex',
    filters.join(';'),
  ];
  const variantMap: string[] = [];
  renditions.forEach((rendition, index) => {
    args.push('-map', `[v${index}]`);
    if (probe.hasAudio) args.push('-map', '0:a:0');
    const gop = Math.max(1, Math.round(probe.frameRate * HLS_SEGMENT_SECONDS));
    args.push(
      `-c:v:${index}`,
      'libx264',
      `-preset:v:${index}`,
      'veryfast',
      `-profile:v:${index}`,
      'main',
      `-pix_fmt:v:${index}`,
      'yuv420p',
      `-b:v:${index}`,
      `${rendition.bitrateKbps}k`,
      `-maxrate:v:${index}`,
      `${Math.round(rendition.bitrateKbps * 1.07)}k`,
      `-bufsize:v:${index}`,
      `${rendition.bitrateKbps * 2}k`,
      `-g:v:${index}`,
      String(gop),
      `-keyint_min:v:${index}`,
      String(gop),
      `-sc_threshold:v:${index}`,
      '0',
      `-force_key_frames:v:${index}`,
      `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    );
    if (probe.hasAudio) {
      args.push(`-c:a:${index}`, 'aac', `-b:a:${index}`, '128k', `-ac:a:${index}`, '2');
    }
    variantMap.push(
      probe.hasAudio
        ? `v:${index},a:${index},name:${rendition.label}`
        : `v:${index},name:${rendition.label}`,
    );
  });
  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(HLS_SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(outputDirectory, '%v', 'segment-%05d.ts'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    variantMap.join(' '),
    path.join(outputDirectory, '%v', 'index.m3u8'),
  );
  return args;
};

export const processVideo = async (
  inputPath: string,
  outputDirectory: string,
  options: ProcessOptions,
): Promise<ProcessedVideo> => {
  let probe: VideoProbe;
  try {
    const result = await runCommand(
      options.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      Math.min(options.timeoutMs, 60_000),
    );
    probe = parseProbeOutput(result.stdout);
  } catch (error) {
    if (
      error instanceof PermanentVideoError ||
      error instanceof VideoProcessTimeoutError ||
      error instanceof VideoProcessLaunchError
    )
      throw error;
    throw new PermanentVideoError('INVALID_MEDIA', 'Video probing failed');
  }
  const renditions = selectVideoRenditions(probe);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    renditions.map((rendition) =>
      mkdir(path.join(outputDirectory, rendition.label), { recursive: true }),
    ),
  );
  try {
    await runCommand(
      options.ffmpegPath,
      buildHlsArguments(inputPath, outputDirectory, probe, renditions),
      options.timeoutMs,
    );
    const posterTimeSeconds = Math.min(1, Math.max(0.1, (probe.durationMs / 1_000) * 0.1));
    await runCommand(
      options.ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'warning',
        '-autorotate',
        '-i',
        inputPath,
        '-ss',
        posterTimeSeconds.toFixed(3),
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-c:v',
        'libwebp',
        '-quality',
        '82',
        path.join(outputDirectory, 'poster.webp'),
      ],
      Math.min(options.timeoutMs, 120_000),
    );
  } catch (error) {
    if (error instanceof VideoProcessTimeoutError || error instanceof VideoProcessLaunchError)
      throw error;
    if (isOperationalProcessFailure(error)) throw error;
    throw new PermanentVideoError('TRANSCODE_FAILED', 'Video transcoding failed');
  }
  const poster = fitWithin(probe.width, probe.height, 640, 640);
  return { probe, renditions, posterWidth: poster.width, posterHeight: poster.height };
};

const runCommand = (
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString('utf8')}`.slice(-PROCESS_OUTPUT_LIMIT_BYTES);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timeout.unref();
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new VideoProcessLaunchError(error.message));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new VideoProcessTimeoutError(`Process exceeded ${timeoutMs} ms`));
      } else if (code !== 0) {
        reject(new Error(`Media process exited ${code}: ${stderr.slice(-2_000)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

const isOperationalProcessFailure = (error: unknown): boolean =>
  error instanceof Error &&
  /(?:no space left on device|resource temporarily unavailable|cannot allocate memory|input\/output error)/i.test(
    error.message,
  );
