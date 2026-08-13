import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '@instaclone/config';

export interface PresignedUploadRequest {
  contentType: string;
  objectKey: string;
  expiresInSeconds?: number;
}

export interface StoredObjectMetadata {
  contentLength: number | null;
  contentType: string | null;
}

export interface StoredObjectStream {
  body: Readable;
  contentLength: number | null;
  contentType: string | null;
}

@Injectable()
export class ObjectStorageService {
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    const common = {
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    };
    this.client = new S3Client({ endpoint: config.get('S3_ENDPOINT', { infer: true }), ...common });
    this.publicClient = new S3Client({
      endpoint:
        config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ??
        config.get('S3_ENDPOINT', { infer: true }),
      ...common,
    });
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createUploadUrl(request: PresignedUploadRequest): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentType: request.contentType,
      Key: request.objectKey,
    });

    return getSignedUrl(this.publicClient, command, { expiresIn: request.expiresInSeconds ?? 300 });
  }

  async headObject(objectKey: string): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      contentLength: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
    };
  }

  createDownloadUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getObjectStream(objectKey: string): Promise<StoredObjectStream> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!result.Body) throw new Error('Stored media object has no body');
    return {
      body: Readable.from(result.Body as AsyncIterable<Uint8Array>),
      contentLength: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
    };
  }
}
