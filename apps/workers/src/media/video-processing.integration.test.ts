import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { processVideo } from './video-processor';
import { VIDEO_UPLOADED_EVENT, type VideoUploadedEvent } from '@instaclone/api-contracts';
import { VideoUploadedJobHandler } from './video-uploaded.job';

const enabled = process.env.RUN_FFMPEG_INTEGRATION === 'true';
const workDirectories: string[] = [];

describe.runIf(enabled)('real FFmpeg video processing', () => {
  afterEach(async () => {
    await Promise.all(
      workDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('generates HLS playlists, aligned segments, and a poster from a synthetic clip', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'instaclone-ffmpeg-test-'));
    workDirectories.push(work);
    const source = path.join(work, 'source.mp4');
    await command('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=360x640:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      source,
    ]);
    const output = path.join(work, 'output');
    const result = await processVideo(source, output, {
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      timeoutMs: 120_000,
    });
    expect(result.probe).toMatchObject({ width: 360, height: 640, hasAudio: true });
    await expect(stat(path.join(output, 'master.m3u8'))).resolves.toBeTruthy();
    await expect(stat(path.join(output, 'poster.webp'))).resolves.toBeTruthy();
    expect((await readdir(path.join(output, '360'))).some((name) => name.endsWith('.ts'))).toBe(
      true,
    );
    await command('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'json',
      path.join(output, '360', 'segment-00000.ts'),
    ]);
  }, 180_000);

  it('runs the real processor through job orchestration and reaches one logical READY result', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'instaclone-ffmpeg-job-test-'));
    workDirectories.push(work);
    const source = path.join(work, 'source.mp4');
    await command('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=360x640:rate=24',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const sourceStat = await stat(source);
    const mediaId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const event: VideoUploadedEvent = {
      eventId: crypto.randomUUID(),
      eventName: VIDEO_UPLOADED_EVENT,
      eventVersion: 1,
      aggregateType: 'MediaAsset',
      aggregateId: mediaId,
      occurredAt: new Date().toISOString(),
      correlationId: 'real-video-job',
      payload: { mediaId, ownerId },
    };
    let finalized = false;
    const repository = {
      claim: () =>
        Promise.resolve({
          id: mediaId,
          ownerId,
          objectKey: 'source',
          declaredMimeType: 'video/mp4',
          verifiedSizeBytes: sourceStat.size,
          kind: 'VIDEO' as const,
          previousWorkerId: null,
        }),
      isTerminal: () => Promise.resolve(false),
      renew: () => Promise.resolve(true),
      completeVideo: () => {
        finalized = true;
        return Promise.resolve(true);
      },
      fail: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const uploaded: string[] = [];
    const storage = {
      downloadToFile: (_key: string, destination: string) => copyFile(source, destination),
      putFile: (key: string) => {
        uploaded.push(key);
        return Promise.resolve();
      },
      deletePrefix: () => Promise.resolve(),
    };
    const handler = new VideoUploadedJobHandler(repository, storage, {
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      timeoutMs: 120_000,
    });
    await expect(handler.handle(event)).resolves.toEqual({ mediaId, status: 'READY' });
    expect(finalized).toBe(true);
    expect(uploaded.some((key) => key.endsWith('/master.m3u8'))).toBe(true);
    expect(uploaded.some((key) => key.endsWith('/poster.webp'))).toBe(true);
    expect(uploaded.some((key) => key.endsWith('.ts'))).toBe(true);
  }, 180_000);
});

const command = (executable: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
