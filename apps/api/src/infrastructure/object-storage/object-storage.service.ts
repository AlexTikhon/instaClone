import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ApiEnvironment } from '@instaclone/config';

export interface PresignedUploadRequest {
  contentType: string;
  objectKey: string;
  expiresInSeconds?: number;
}

@Injectable()
export class ObjectStorageService {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
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

    return getSignedUrl(this.client, command, { expiresIn: request.expiresInSeconds ?? 300 });
  }
}
