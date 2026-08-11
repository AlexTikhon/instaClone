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

  async claim(event: MediaUploadedEvent): Promise<ProcessingAsset | null> {
    const result = await this.pool.query<ProcessingAsset>(
      `UPDATE media_assets
       SET status = 'PROCESSING', "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "ownerId" = $2
         AND status IN ('UPLOADED', 'PROCESSING')
       RETURNING id, "ownerId", "objectKey", "declaredMimeType", "verifiedSizeBytes"`,
      [event.payload.mediaId, event.payload.ownerId],
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
    metadata: { width: number; height: number; thumbnailObjectKey: string },
  ): Promise<void> {
    await this.transaction(async (client) => {
      if (!(await this.recordReceipt(client, eventId))) return;
      await client.query(
        `UPDATE media_assets
         SET status = 'READY', width = $2, height = $3, "thumbnailObjectKey" = $4,
             "failureCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'PROCESSING'`,
        [mediaId, metadata.width, metadata.height, metadata.thumbnailObjectKey],
      );
    });
  }

  async fail(eventId: string, mediaId: string, failureCode: string): Promise<void> {
    await this.transaction(async (client) => {
      if (!(await this.recordReceipt(client, eventId))) return;
      await client.query(
        `UPDATE media_assets
         SET status = 'FAILED', "failureCode" = $2, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'PROCESSING'`,
        [mediaId, failureCode],
      );
    });
  }

  private async recordReceipt(client: PoolClient, eventId: string): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO consumer_event_receipts ("eventId", "consumerName")
       VALUES ($1, 'media-processor-v1')
       ON CONFLICT DO NOTHING`,
      [eventId],
    );
    return result.rowCount === 1;
  }

  private async transaction(operation: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await operation(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
