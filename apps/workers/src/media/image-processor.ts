import sharp from 'sharp';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 12_000;
const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class PermanentMediaError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ProcessedImage {
  width: number;
  height: number;
  thumbnail: Uint8Array;
}

export const processImage = async (input: Uint8Array): Promise<ProcessedImage> => {
  if (input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
    throw new PermanentMediaError('FILE_SIZE_INVALID', 'Image file size is invalid');
  }
  try {
    const image = sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !SUPPORTED_FORMATS.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new PermanentMediaError('FORMAT_UNSUPPORTED', 'Decoded image format is unsupported');
    }
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      throw new PermanentMediaError(
        'DIMENSIONS_EXCEEDED',
        'Decoded image dimensions are too large',
      );
    }
    const thumbnail = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { width: metadata.width, height: metadata.height, thumbnail };
  } catch (error) {
    if (error instanceof PermanentMediaError) throw error;
    throw new PermanentMediaError('DECODE_FAILED', 'Image decoding failed');
  }
};

export const thumbnailObjectKey = (ownerId: string, mediaId: string): string =>
  `users/${ownerId}/media/${mediaId}/thumb-640`;
