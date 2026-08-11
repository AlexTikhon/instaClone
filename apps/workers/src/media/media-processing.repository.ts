import type { Pool, PoolClient } from 'pg';

import type { MediaUploadedEvent } from '@instaclone/api-contracts';

export interface ProcessingAsset {
  id: string;
  ownerId: string;
  objectKey: string;
  declaredMimeType: string;
  verifiedSizeBytes: number | null;
}

export class MediaProcessingRepository {
  constructor(private readonly pool: Pool) {}

  async claim(
    event: MediaUploadedEvent,
    workerId: string,
    leaseMs = 60_000,
  ): Promise<ProcessingAsset | null> {
    const result = await this.pool.query<ProcessingAsset>(
      `UPDATE media_assets
       SET status = 'PROCESSING',
           "processingStartedAt" = CURRENT_TIMESTAMP,
           "processingLeaseUntil" = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 millisecond'),
           "processingWorkerId" = $3,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "ownerId" = $2
         AND (
           status = 'UPLOADED'
           OR (
             status = 'PROCESSING'
             AND ("processingLeaseUntil" IS NULL OR "processingLeaseUntil" < CURRENT_TIMESTAMP)
           )
         )
       RETURNING id, "ownerId", "objectKey", "declaredMimeType", "verifiedSizeBytes"`,
      [event.payload.mediaId, event.payload.ownerId, workerId, leaseMs],
    );
    return result.rows[0] ?? null;
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
