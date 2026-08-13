import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { MediaUploadedEvent, VideoUploadedEvent } from '@instaclone/api-contracts';

export interface ProcessingAsset {
  id: string;
  ownerId: string;
  objectKey: string;
  declaredMimeType: string;
  verifiedSizeBytes: number | null;
  kind: 'IMAGE' | 'VIDEO';
  previousWorkerId: string | null;
}

export interface VideoVariantRecord {
  type: 'HLS_MASTER' | 'HLS_RENDITION' | 'POSTER';
  label: string;
  objectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
}

export class MediaProcessingRepository {
  constructor(private readonly pool: Pool) {}

  async claim(
    event: MediaUploadedEvent | VideoUploadedEvent,
    workerId: string,
    leaseMs = 60_000,
  ): Promise<ProcessingAsset | null> {
    const result = await this.pool.query<ProcessingAsset>(
      `WITH candidate AS (
         SELECT id, "processingWorkerId" AS "previousWorkerId"
         FROM media_assets
         WHERE id = $1 AND "ownerId" = $2
           AND (
             status = 'UPLOADED'
             OR (
               status = 'PROCESSING'
               AND ("processingLeaseUntil" IS NULL OR "processingLeaseUntil" < CURRENT_TIMESTAMP)
             )
           )
         FOR UPDATE
       )
       UPDATE media_assets AS asset
       SET status = 'PROCESSING',
           "processingStartedAt" = CURRENT_TIMESTAMP,
           "processingLeaseUntil" = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 millisecond'),
           "processingWorkerId" = $3,
           "updatedAt" = CURRENT_TIMESTAMP
       FROM candidate
       WHERE asset.id = candidate.id
       RETURNING asset.id, asset."ownerId", asset."objectKey", asset."declaredMimeType",
         asset."verifiedSizeBytes", asset.kind, candidate."previousWorkerId"`,
      [event.payload.mediaId, event.payload.ownerId, workerId, leaseMs],
    );
    return result.rows[0] ?? null;
  }

  async renew(mediaId: string, workerId: string, leaseMs = 60_000): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE media_assets
       SET "processingLeaseUntil" = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PROCESSING' AND "processingWorkerId" = $2`,
      [mediaId, workerId, leaseMs],
    );
    return result.rowCount === 1;
  }

  async isTerminal(mediaId: string): Promise<boolean> {
    const result = await this.pool.query<{ status: string }>(
      `SELECT status FROM media_assets WHERE id = $1`,
      [mediaId],
    );
    return ['READY', 'FAILED'].includes(result.rows[0]?.status ?? '');
  }

  async complete(
    eventId: string,
    mediaId: string,
    workerId: string,
    metadata: { width: number; height: number; thumbnailObjectKey: string },
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE media_assets
         SET status = 'READY', width = $2, height = $3, "thumbnailObjectKey" = $4,
             "failureCode" = NULL, "processingLeaseUntil" = NULL,
             "processingWorkerId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'PROCESSING' AND "processingWorkerId" = $5`,
        [mediaId, metadata.width, metadata.height, metadata.thumbnailObjectKey, workerId],
      );
      if (result.rowCount !== 1) return false;
      await this.recordReceipt(client, eventId);
      return true;
    });
  }

  async fail(
    eventId: string,
    mediaId: string,
    workerId: string,
    failureCode: string,
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE media_assets
         SET status = 'FAILED', "failureCode" = $2, "processingLeaseUntil" = NULL,
             "processingWorkerId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'PROCESSING' AND "processingWorkerId" = $3`,
        [mediaId, failureCode, workerId],
      );
      if (result.rowCount !== 1) return false;
      await this.recordReceipt(client, eventId);
      return true;
    });
  }

  async completeVideo(
    eventId: string,
    mediaId: string,
    workerId: string,
    metadata: {
      width: number;
      height: number;
      durationMs: number;
      videoCodec: string;
      audioCodec: string | null;
      frameRate: number;
      rotationDegrees: number;
      processingVersion: number;
      posterObjectKey: string;
      variants: VideoVariantRecord[];
    },
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE media_assets
         SET status = 'READY', width = $2, height = $3, "durationMs" = $4,
             "videoCodec" = $5, "audioCodec" = $6, "frameRate" = $7,
             "rotationDegrees" = $8, "processingVersion" = $9,
             "thumbnailObjectKey" = $10, "failureCode" = NULL,
             "processingLeaseUntil" = NULL, "processingWorkerId" = NULL,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND kind = 'VIDEO' AND status = 'PROCESSING'
           AND "processingWorkerId" = $11`,
        [
          mediaId,
          metadata.width,
          metadata.height,
          metadata.durationMs,
          metadata.videoCodec,
          metadata.audioCodec,
          metadata.frameRate,
          metadata.rotationDegrees,
          metadata.processingVersion,
          metadata.posterObjectKey,
          workerId,
        ],
      );
      if (result.rowCount !== 1) return false;
      await client.query(`DELETE FROM media_variants WHERE "mediaAssetId" = $1`, [mediaId]);
      for (const variant of metadata.variants) {
        await client.query(
          `INSERT INTO media_variants
            (id, "mediaAssetId", type, label, "processingVersion", "objectKey", "mimeType",
             width, height, "bitrateKbps")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            randomUUID(),
            mediaId,
            variant.type,
            variant.label,
            metadata.processingVersion,
            variant.objectKey,
            variant.mimeType,
            variant.width,
            variant.height,
            variant.bitrateKbps,
          ],
        );
      }
      await this.recordReceipt(client, eventId);
      return true;
    });
  }

  async release(mediaId: string, workerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE media_assets
       SET status = 'UPLOADED', "processingLeaseUntil" = NULL,
           "processingWorkerId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PROCESSING' AND "processingWorkerId" = $2`,
      [mediaId, workerId],
    );
  }

  private async recordReceipt(client: PoolClient, eventId: string): Promise<void> {
    await client.query(
      `INSERT INTO consumer_event_receipts ("eventId", "consumerName")
       VALUES ($1, 'media-processor-v1')
       ON CONFLICT DO NOTHING`,
      [eventId],
    );
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
