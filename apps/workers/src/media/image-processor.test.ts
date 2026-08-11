import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { PermanentMediaError, processImage, thumbnailObjectKey } from './image-processor';

describe('bounded image processing', () => {
  it('decodes supported bytes and creates a bounded WebP thumbnail', async () => {
    const original = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#ff7657' },
    })
      .png()
      .toBuffer();
    const result = await processImage(original);
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect(result).toMatchObject({ width: 1200, height: 800 });
    expect(thumbnail).toMatchObject({ format: 'webp', width: 640, height: 427 });
  });

  it('rejects bytes that do not decode as an accepted image', async () => {
    await expect(processImage(new TextEncoder().encode('not an image'))).rejects.toBeInstanceOf(
      PermanentMediaError,
    );
    expect(thumbnailObjectKey('owner', 'media')).toBe('users/owner/media/media/thumb-640');
  });
});
