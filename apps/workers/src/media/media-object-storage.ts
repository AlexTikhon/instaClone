import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export class MediaObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async download(objectKey: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error('Stored media object has no body');
    return response.Body.transformToByteArray();
  }

  async putThumbnail(objectKey: string, body: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: 'image/webp',
      }),
    );
  }
}
